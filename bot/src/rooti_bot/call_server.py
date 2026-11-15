"""`rooti-bot llamada`: the live call behind «📞 Hablar con Rooti». The button opens bot/call/ with a signed token;
the page sends its microphone over WebRTC (Pipecat's SmallWebRTC, peer to peer, no media server) and Rooti answers
by voice with the same tools as on WhatsApp. Speech: Groq Whisper in, Edge TTS's Ecuadorian voice out, both free.

Runs in its own venv (Dockerfile: /opt/rooti/.venv-call), since Pipecat and aiortc are heavy."""
import asyncio
import json
import os
import subprocess
from collections.abc import AsyncGenerator, AsyncIterator

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import ErrorFrame, Frame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from rooti_bot import calls, config, store, tools, voice, web, web_agent

PAGE = config.BOT_DIR / "call"
# The audio goes over UDP straight between the phone and this server. STUN lets each side learn its public address;
# behind strict NAT (a Docker bridge, a carrier's CGNAT) only a TURN relay gets through: ROOTI_ICE_SERVERS takes
# that list as JSON, for both the server and the page.
ICE = json.loads(os.environ.get("ROOTI_ICE_SERVERS") or '[{"urls": "stun:stun.l.google.com:19302"}]')
EDGE_RATE = 24000  # Edge TTS speaks 24 kHz mp3; ffmpeg turns each sentence into PCM at that rate
CALL_RULES = """
## En esta llamada

Ahora hablas en vivo, por voz, con el agricultor (como una llamada), con la misma personalidad costeña. Frases todavía
más cortas: una o dos por turno, y deja hablar al agricultor. Nada de emojis, símbolos ni números con decimales: «casi dos cuadras», «unos cuarenta
milímetros». Si te interrumpe, para y escúchalo. Cuando ya no tenga preguntas, despídete en una frase.
"""


class EdgeTTSService(TTSService):
    """Edge TTS (free, the voice Vinci and Rooti use on WhatsApp), sentence by sentence."""

    def __init__(self, voice_name: str = voice.VOICE, **kwargs):
        super().__init__(sample_rate=EDGE_RATE, settings=TTSSettings(model=None, voice=voice_name, language="es-EC"),
                         **kwargs)
        self._voice = voice_name

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        import edge_tts

        try:
            await self.start_tts_usage_metrics(text)
            mp3 = b"".join([chunk["data"] async for chunk in edge_tts.Communicate(voice.speakable(text), self._voice).stream()
                            if chunk["type"] == "audio"])
            proc = await asyncio.to_thread(subprocess.run, ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le",
                                                            "-ac", "1", "-ar", str(EDGE_RATE), "pipe:1"],
                                           input=mp3, capture_output=True, check=True)

            async def pcm() -> AsyncIterator[bytes]:
                step = EDGE_RATE // 10 * 2  # 100 ms of 16-bit mono
                for i in range(0, len(proc.stdout), step):
                    yield proc.stdout[i:i + step]

            async for frame in self._stream_audio_frames_from_iterator(pcm(), in_sample_rate=EDGE_RATE,
                                                                        context_id=context_id):
                await self.stop_ttfb_metrics()
                yield frame
        except Exception as exc:
            logger.error(f"Edge TTS: {exc}")
            yield ErrorFrame(error=f"Edge TTS: {exc}")


def _llm(system: str):
    provider, model = config.model()
    if provider == "deepseek":
        from pipecat.services.deepseek.llm import DeepSeekLLMService
        return DeepSeekLLMService(api_key=os.environ["DEEPSEEK_API_KEY"],
                                  settings=DeepSeekLLMService.Settings(model=model, system_instruction=system))
    from pipecat.services.openai.llm import OpenAILLMService
    return OpenAILLMService(api_key=os.environ["OPENAI_API_KEY"],
                            settings=OpenAILLMService.Settings(model=model, system_instruction=system),
                            **({"base_url": os.environ["ROOTI_LLM_BASE_URL"]} if os.environ.get("ROOTI_LLM_BASE_URL") else {}))


def _opening(session: dict) -> str:
    """What Rooti says first: why it called, or a plain hello when the farmer opened the call from the chat."""
    alert = session.get("alert")
    if alert:
        return (f"El agricultor tocó «Hablar con Rooti» bajo este aviso tuyo: «{alert['text']}». Empieza tú: salúdalo, "
                "dile en una o dos frases qué significa para su lote y qué conviene hacer, y pregúntale si tiene dudas.")
    return "El agricultor abrió la llamada desde el chat. Salúdalo en una frase y pregúntale en qué le ayudas."


async def run_call(connection: SmallWebRTCConnection, session: dict) -> None:
    farmer_id = session["phone"]
    soul = (config.TEMPLATES / "rooti" / "SOUL.md").read_text(encoding="utf-8")
    from rooti_bot.cli import context
    messages = [{"role": "user", "content": _opening(session)}]

    llm = _llm(f"{soul}\n{CALL_RULES}\n## Contexto\n\n{context(farmer_id)}")
    schemas = []
    for tool in tools.TOOLS:
        if tool.name in tools.CHAT_ONLY:
            continue

        async def handler(params: FunctionCallParams, name=tool.name):
            try:
                result = await asyncio.to_thread(tools.call, name, farmer_id, dict(params.arguments or {}))
            except tools.ToolError as exc:
                result = {"error": str(exc)}
            await params.result_callback(result)

        llm.register_function(tool.name, handler)
        schemas.append(FunctionSchema(name=tool.name, description=tool.description, properties=tool.properties,
                                      required=list(tool.required)))

    context = LLMContext(messages, tools=ToolsSchema(standard_tools=schemas))
    aggregators = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()))
    from pipecat.services.groq.stt import GroqSTTService
    stt = GroqSTTService(api_key=os.environ["GROQ_API_KEY"],
                         settings=GroqSTTService.Settings(model="whisper-large-v3-turbo", language=Language.ES))
    transport = SmallWebRTCTransport(webrtc_connection=connection,
                                     params=TransportParams(audio_in_enabled=True, audio_out_enabled=True))
    pipeline = Pipeline([transport.input(), stt, aggregators.user(), llm, EdgeTTSService(), transport.output(),
                         aggregators.assistant()])
    task = PipelineTask(pipeline, idle_timeout_secs=120)

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    runner.add_workers(task)
    await runner.run()


def app() -> FastAPI:
    api = FastAPI()
    handler = SmallWebRTCRequestHandler(ice_servers=[IceServer(**server) for server in ICE])

    @api.get("/llamada")
    async def page():
        return FileResponse(PAGE / "index.html")

    @api.get("/api/ice")
    async def ice():
        return ICE

    @api.post("/api/offer")
    async def offer(request: Request, background: BackgroundTasks):
        body = await request.json()
        try:
            session = calls.redeem(str((body.get("request_data") or {}).get("token", "")))
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(403, f"Enlace no válido: {exc}") from None
        if session["farmer"] is None:
            raise HTTPException(404, "No conozco este lote.")
        if session["alert"]:
            store.mark_alert(session["alert"]["id"], "call_opened_at")

        async def start(connection: SmallWebRTCConnection):
            background.add_task(run_call, connection, session)

        return await handler.handle_web_request(
            SmallWebRTCRequest(sdp=body["sdp"], type=body["type"], pc_id=body.get("pc_id"),
                               restart_pc=body.get("restart_pc")), start)

    @api.patch("/api/offer")
    async def candidate(request: Request):
        body = await request.json()
        await handler.handle_patch_request(SmallWebRTCPatchRequest(
            pc_id=body["pc_id"], candidates=[IceCandidate(**c) for c in body.get("candidates", [])]))
        return {"status": "success"}

    web.mount(api)
    web_agent.mount(api)
    api.mount("/static", StaticFiles(directory=PAGE), name="static")
    web.mount_site(api)  # last: the web app answers every path the routes above do not
    return api


def serve(host: str, port: int) -> int:
    import uvicorn
    uvicorn.run(app(), host=host, port=port, log_level="info")
    return 0
