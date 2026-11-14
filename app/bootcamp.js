import { BOOTCAMP, CROP_GUIDE, SOURCES } from "./bootcamp-content.js?v=2";

const PROGRESS_KEY = "bootcamp1";
const PHOTO_SOURCE = "https://commons.wikimedia.org/wiki/File:Corn_in_a_field_by_Myrstigen_1.jpg";
const CROP_MARKS = {
  rice: "🌾", maize: "🌽", soybean: "🫘", potato: "🥔", common_bean: "🫘", peanut: "🥜",
  sorghum: "🌾", wheat: "🌾", barley: "🌾", sunflower: "🌻", chickpea: "🫘", cowpea: "🫘",
  jack_bean: "🌿", velvet_bean: "🌿",
};
const LESSON_ICONS = ["i-sprout", "i-leaf", "i-calendar", "i-history"];

export function createBootcamp({ h, put, icon, store, speak }) {
  const progress = store.get(PROGRESS_KEY, { current: 0, completed: [] });
  const isComplete = (index) => progress.completed.includes(index);
  const external = (label, href) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label);

  return function bootcampPage(lang, crops, planLabel, onPlan) {
    const text = BOOTCAMP[lang];
    const last = text.lessons.length - 1;
    const path = h("ol", { class: "bc-path", "aria-label": text.path });
    const card = h("section", { class: "bc-lesson", "aria-labelledby": "bc-lesson-title" });
    const count = h("p", { class: "bc-count" });
    const meter = h("progress", { max: text.lessons.length, "aria-label": text.path });
    const startLabel = h("span");
    let narration;
    const mark = (id) => h("span", { class: "bc-crop-mark", "aria-hidden": "true" }, CROP_MARKS[id] || icon("i-sprout"));

    function updatePath() {
      count.textContent = text.progress(progress.completed.length);
      meter.value = progress.completed.length;
      startLabel.textContent = text.start;
      if (progress.current || progress.completed.length) startLabel.textContent = text.resume;
      if (progress.completed.length === text.lessons.length) startLabel.textContent = text.review;
      const available = text.lessons.findIndex((_, index) => !isComplete(index));
      put(path, text.lessons.map((lesson, index) => h("li", {},
        h("button", {
          type: "button",
          "aria-current": index === progress.current ? "step" : null,
          disabled: available !== -1 && index > available,
          onclick: () => renderLesson(index, true),
        }, h("span", { class: "bc-step", "aria-hidden": "true" }, icon(isComplete(index) ? "i-check" : LESSON_ICONS[index])), lesson.title),
      )));
    }

    function renderLesson(index, moveFocus = false) {
      if (narration) window.speechSynthesis.cancel();
      narration = null;
      progress.current = index;
      store.set(PROGRESS_KEY, progress);
      const lesson = text.lessons[index];
      const final = index === last;
      const title = h("h2", { class: "display", id: "bc-lesson-title", tabindex: "-1" }, lesson.title);
      const listenLabel = h("span", {}, text.listen);
      const listen = window.speechSynthesis ? h("button", {
        class: "bc-listen",
        type: "button",
        onclick: () => {
          if (narration) {
            window.speechSynthesis.cancel();
            narration = null;
            listenLabel.textContent = text.listen;
            return;
          }
          const lines = [lesson.title, ...(lesson.paragraphs || []),
            ...(lesson.facts || []).map(([label, detail]) => `${label}. ${detail}`), lesson.example,
            ...(index === 2 ? [text.sequenceNote] : []),
            ...lesson.questions.flatMap(({ prompt, options }) => [prompt, ...options])];
          const reading = speak(lines.filter(Boolean).join(" "));
          if (!reading) return;
          narration = reading;
          listenLabel.textContent = text.stop;
          const done = () => {
            if (narration !== reading) return;
            narration = null;
            listenLabel.textContent = text.listen;
          };
          reading.addEventListener("end", done, { once: true });
          reading.addEventListener("error", done, { once: true });
        },
      }, icon("i-volume"), listenLabel) : null;
      const status = h("p", { class: "bc-status", role: "status" });
      const next = final ? null : h("button", {
        class: "btn dark",
        type: "button",
        disabled: !isComplete(index),
        onclick: () => renderLesson(index + 1, true),
      }, text.next, icon("i-arrow-r"));
      const reward = final ? h("div", { class: "bc-reward", hidden: !isComplete(index) },
        h("strong", {}, icon("i-badge"), text.badge),
        h("p", {}, text.passed),
        h("a", { class: "btn dark", href: "#/planear", onclick: onPlan }, planLabel, icon("i-arrow-r")),
      ) : null;
      const feedback = lesson.questions.map(() => h("p", { class: "bc-feedback", hidden: true }));

      const form = h("form", {
        class: "bc-practice",
        onsubmit: (event) => {
          event.preventDefault();
          const answers = new FormData(event.currentTarget);
          let correct = 0;
          lesson.questions.forEach((question, i) => {
            const matched = answers.get(`question-${i}`) === String(question.answer);
            if (matched) correct++;
            const output = feedback[i];
            output.className = matched ? "bc-feedback correct" : "bc-feedback incorrect";
            output.hidden = false;
            put(output, icon(matched ? "i-check" : "i-info"), h("span", {},
              h("b", {}, matched ? text.correct : text.incorrect), " · ", question.why));
          });
          if (correct === lesson.questions.length) {
            if (!isComplete(index)) {
              progress.completed.push(index);
              store.set(PROGRESS_KEY, progress);
              updatePath();
            }
            if (next) next.disabled = false;
            if (reward) reward.hidden = false;
          }
          status.textContent = final
            ? (correct === lesson.questions.length ? text.complete : text.retry(correct, lesson.questions.length))
            : `${correct ? text.correct : text.incorrect}. ${lesson.questions[0].why}`;
        },
      },
      h("h3", {}, final ? text.quiz : text.practice),
      final ? h("p", {}, text.quizHelp) : null,
      lesson.questions.map((question, i) => h("fieldset", {},
        h("legend", {}, question.prompt),
        question.options.map((option, j) => h("label", { class: "bc-option" },
          h("input", { type: "radio", name: `question-${i}`, value: j, required: true }), option,
        )),
        feedback[i],
      )),
      h("button", { class: "btn light", type: "submit" }, final ? text.grade : text.check),
      final ? status : h("div", { class: "bc-sr-only" }, status));

      put(card,
        h("div", { class: "bc-lesson-head" }, h("p", { class: "bc-kicker" }, text.lesson(index + 1)), listen),
        title,
        lesson.paragraphs?.map((line) => h("p", {}, line)),
        lesson.facts ? h("dl", { class: "bc-facts" }, lesson.facts.map(([label, detail]) =>
          h("div", {}, h("dt", {}, label), h("dd", {}, detail)))) : null,
        lesson.example ? h("p", { class: "bc-example" }, lesson.example) : null,
        index === 2 ? h("div", { class: "bc-sequence" },
          h("h3", {}, text.sequence),
          h("div", { class: "bc-sequence-flow" },
            h("span", {}, mark("rice"), crops.find((crop) => crop.id === "rice")?.name),
            icon("i-arrow-r"),
            h("span", {}, mark("soybean"), crops.find((crop) => crop.id === "soybean")?.name)),
          h("p", {}, text.sequenceNote)) : null,
        form,
        reward,
        h("div", { class: "bc-actions" },
          index > 0 ? h("button", { class: "btn light", type: "button", onclick: () => renderLesson(index - 1, true) },
            icon("i-back"), text.previous) : null,
          next,
        ),
      );
      updatePath();
      if (moveFocus) title.focus();
    }

    renderLesson(progress.current);

    const cropTitle = h("h2", { class: "display", id: "bc-crops-title", tabindex: "-1" }, text.cropTitle);
    const cropCards = crops.filter(({ id }) => CROP_GUIDE[id]).map(({ id, name, months }) => {
      const [group, es, en] = CROP_GUIDE[id];
      return h("li", {},
        h("details", { name: "bootcamp-crop", class: "bc-crop-card" },
          h("summary", {}, mark(id), h("span", {}, h("strong", {}, name), h("small", {}, text.cropGroups[group])), icon("i-chev-d")),
          h("div", { class: "bc-crop-detail" },
            h("p", { class: "bc-kicker" }, text.cycle(months)),
            h("p", {}, lang === "es" ? es : en))));
    });

    return h("div", { class: "bootcamp" },
      h("header", { class: "bc-hero" },
        h("div", { class: "bc-intro" },
          h("p", { class: "bc-kicker" }, text.meta),
          h("h1", { class: "display" }, text.title),
          h("p", {}, text.intro),
          h("div", { class: "bc-hero-actions" },
            h("button", { type: "button", class: "btn bc-start", onclick: () => renderLesson(progress.current, true) },
              startLabel, icon("i-arrow-r")),
            h("button", { type: "button", class: "btn bc-crop-jump", onclick: () => cropTitle.focus() }, icon("i-sprout"), text.cropTitle)),
        ),
        h("figure", {},
          h("img", { src: "img/maize.jpg", alt: "" }),
          h("figcaption", {}, external(text.credit, PHOTO_SOURCE)),
        ),
      ),
      h("div", { class: "bc-course" },
        h("aside", { class: "bc-sidebar" }, count, meter, path),
        card,
      ),
      h("section", { class: "bc-catalog", "aria-labelledby": "bc-crops-title" },
        h("header", {}, cropTitle, h("p", {}, text.cropIntro)),
        h("ul", { class: "bc-crop-grid" }, cropCards),
        h("div", { class: "bc-sequence" },
          h("h3", {}, icon("i-leaf"), " ", text.straw),
          h("p", {}, text.strawNote))),
      h("section", { class: "bc-resources" },
        h("h2", { class: "display" }, text.courses),
        h("ul", { class: "bc-resource-cards" }, text.resources.map(([provider, name, description, url]) =>
          h("li", { class: "card" },
            h("p", { class: "bc-kicker" }, provider),
            h("h3", {}, external(name, url)),
            h("p", {}, description),
          ))),
        h("h3", {}, text.guides),
        h("ul", { class: "bc-source-list" }, text.local.map(([label, url]) => h("li", {}, external(label, url)))),
        h("p", { class: "small" }, text.references + " · ", external("SARE · Crop Rotation on Organic Farms", SOURCES.sare)),
      ),
    );
  };
}
