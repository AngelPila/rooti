"""What the call page does (bot/call/call.js), with aiortc: a microphone and a video slot, then POST /api/offer.
Runs in the call venv: python call_probe.py <call url> <token> <wav>. Prints the answer and the connection state."""
import asyncio
import json
import sys
import urllib.request

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer


async def offer(base: str, token: str, wav: str) -> dict:
    pc = RTCPeerConnection()
    pc.addTransceiver(MediaPlayer(wav).audio, direction="sendrecv")
    pc.addTransceiver("video", direction="sendrecv")
    await pc.setLocalDescription(await pc.createOffer())
    body = json.dumps({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type,
                       "request_data": {"token": token}}).encode()
    request = urllib.request.Request(f"{base}/api/offer", data=body, headers={"Content-Type": "application/json"})
    answer = json.loads(urllib.request.urlopen(request, timeout=30).read())
    await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
    for _ in range(50):
        if pc.connectionState == "connected":
            break
        await asyncio.sleep(0.2)
    state = pc.connectionState
    await pc.close()
    return {"type": answer["type"], "state": state}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(offer(*sys.argv[1:4]))))
