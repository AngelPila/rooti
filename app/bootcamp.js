import { BOOTCAMP, CROP_GUIDE } from "./bootcamp-content.js?v=6";
import { BOOTCAMP_COURSES } from "./bootcamp-courses.js?v=2";

const PROGRESS_KEY = "bootcamp2";
const LESSON_ICONS = ["i-sprout", "i-leaf", "i-calendar", "i-history"];
const COURSE_ART = {
  rotation: { image: "img/illu/maize-clean.png", accent: "#E6AE2E", tint: "#FFF2CE" },
  soil: { image: "img/illu/mulch-clean.png", accent: "#78B957", tint: "#EAF3DD" },
  water: { image: "img/illu/rice-clean.png", accent: "#4A7FC1", tint: "#E5EFF8" },
  seeds: { image: "img/maize.jpg", accent: "#D18A35", tint: "#F9EAD8" },
  pests: { image: "img/illu/soybean-clean.png", accent: "#2E9E92", tint: "#DFF2EF" },
};

export function createBootcamp({ h, put, icon, tile, store, speak }) {
  const savedProgress = store.get(PROGRESS_KEY, {}) || {};
  if (!savedProgress.rotation) {
    const legacy = store.get("bootcamp1", null);
    if (legacy && Array.isArray(legacy.completed)) {
      savedProgress.rotation = {
        current: Number.isInteger(legacy.current) ? Math.max(0, Math.min(3, legacy.current)) : 0,
        completed: legacy.completed.filter((index) => Number.isInteger(index) && index >= 0 && index < 4),
      };
      store.set(PROGRESS_KEY, savedProgress);
    }
  }
  const saveProgress = () => store.set(PROGRESS_KEY, savedProgress);
  const progressFor = (id) => (savedProgress[id] ||= { current: 0, completed: [] });
  const external = (label, href) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label);

  return function bootcampPage(lang, crops, planLabel, onPlan, section, courseId, lessonNumber) {
    const text = BOOTCAMP[lang];
    const courses = BOOTCAMP_COURSES[lang].map((item, index) => ({ ...item, lessons: item.lessons || text.lessons, id: item.id || `course-${index}` }));
    const course = ["curso", "leccion"].includes(section) ? courses.find((item) => item.id === courseId) : null;
    const progress = course ? progressFor(course.id) : null;
    const isComplete = (index) => Boolean(progress?.completed.includes(index));
    const last = course ? course.lessons.length - 1 : -1;
    const questionsInCourse = (item) => item.lessons.reduce((sum, lesson) => sum + lesson.questions.length, 0);
    const courseDone = (item) => progressFor(item.id).completed.length === item.lessons.length;
    const path = h("ol", { class: "bc-path", "aria-label": text.path });
    const card = h("section", { class: "bc-lesson", "aria-labelledby": "bc-lesson-title" });
    const count = h("p", { class: "bc-count" });
    const meter = h("progress", { max: text.lessons.length, "aria-label": text.path });
    const startLabel = h("span", {}, text.start);
    let narration;
    const mark = (id) => tile(id);
    const art = (id) => COURSE_ART[id] || COURSE_ART.rotation;
    const illustratedHeader = (item, kicker, heading, description, extraClass = "") => h("header", {
      class: `bc-content-heading bc-illustrated ${extraClass}`,
      style: { "--bc-accent": art(item.id).accent, "--bc-tint": art(item.id).tint },
    },
    h("div", { class: "bc-heading-copy" },
      h("p", { class: "bc-kicker" }, kicker),
      h("h1", { class: "display" }, heading),
      h("p", {}, description)),
    h("img", { src: art(item.id).image, alt: "", loading: "lazy" }),
    );

    function updatePath() {
      count.textContent = text.progress(progress.completed.length, course.lessons.length);
      meter.max = course.lessons.length;
      meter.value = progress.completed.length;
      const available = course.lessons.findIndex((_, index) => !isComplete(index));
      put(path, course.lessons.map((lesson, index) => h("li", {},
        h("button", {
          type: "button",
          "aria-current": index === progress.current ? "step" : null,
          disabled: available !== -1 && index > available,
          onclick: () => { location.hash = `#/bootcamp/leccion/${course.id}/${index + 1}`; },
        }, h("span", { class: "bc-step", "aria-hidden": "true" }, icon(isComplete(index) ? "i-check" : LESSON_ICONS[index % LESSON_ICONS.length])), lesson.title),
      )));
    }

    function renderLesson(index, moveFocus = false) {
      if (narration) window.speechSynthesis.cancel();
      narration = null;
      progress.current = index;
      saveProgress();
      const lesson = course.lessons[index];
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
        onclick: () => { location.hash = `#/bootcamp/leccion/${course.id}/${index + 2}`; },
      }, text.next, icon("i-arrow-r"));
      const reward = final ? h("div", { class: "bc-reward", hidden: !isComplete(index) },
        h("strong", {}, icon("i-badge"), text.badge),
        h("p", {}, text.passed),
        h("p", { class: "bc-recommend" }, text.reviewRecommend),
        h("a", { class: "btn light", href: "#/bootcamp/cultivos" }, icon("i-leaf"), text.exploreCrops, icon("i-arrow-r")),
        h("a", { class: "btn dark", href: "#/planear", onclick: onPlan }, planLabel, icon("i-arrow-r")),
      ) : null;
      const feedback = lesson.questions.map(() => h("p", { class: "bc-feedback", hidden: true }));

      const form = h("form", {
        class: "bc-practice",
        onsubmit: (event) => {
          event.preventDefault();
          const answers = new FormData(event.currentTarget);
          let correct = 0;
          const explanations = [];
          lesson.questions.forEach((question, i) => {
            const matched = answers.get(`question-${i}`) === String(question.answer);
            if (matched) correct++;
            else explanations.push(question.why);
            const output = feedback[i];
            output.className = matched ? "bc-feedback correct" : "bc-feedback incorrect";
            output.hidden = false;
            put(output, icon(matched ? "i-check" : "i-info"), h("span", {},
              h("b", {}, matched ? text.correct : text.incorrect), " · ", question.why));
          });
          if (correct === lesson.questions.length) {
            if (!isComplete(index)) {
              progress.completed.push(index);
              saveProgress();
              updatePath();
            }
            if (next) next.disabled = false;
            if (reward) reward.hidden = false;
          }
          const blocked = !final && !isComplete(index) && correct !== lesson.questions.length;
          status.className = `bc-status ${correct === lesson.questions.length ? "success" : blocked ? "blocked" : "retry"}`;
          status.textContent = correct === lesson.questions.length
            ? (final ? text.complete : text.lessonComplete)
            : (blocked ? text.completeBeforeNext(correct, lesson.questions.length) : text.retry(correct, lesson.questions.length));
          if (explanations.length) status.textContent += ` ${explanations.join(" ")}`;
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
      status);

      const opening = h("div", { class: "bc-lesson-opening", style: { "--bc-accent": art(course.id).accent, "--bc-tint": art(course.id).tint } },
        h("div", { class: "bc-lesson-opening-copy" },
          h("div", { class: "bc-lesson-head" }, h("p", { class: "bc-kicker" }, text.lesson(index + 1, course.lessons.length)), listen),
          title,
          h("p", { class: "bc-lesson-lead" }, lesson.paragraphs?.[0] || course.description)),
        h("img", { src: art(course.id).image, alt: "", loading: "lazy" }),
      );
      put(card,
        opening,
        lesson.paragraphs?.slice(1).map((line) => h("p", { class: "bc-lesson-body-text" }, line)),
        lesson.facts ? h("dl", { class: "bc-facts" }, lesson.facts.map(([label, detail]) =>
          h("div", {}, h("dt", {}, label), h("dd", {}, detail)))) : null,
        lesson.example ? h("p", { class: "bc-example" }, lesson.example) : null,
        lesson.sequence || (course.id === "rotation" && index === 2) ? h("div", { class: "bc-sequence" },
          h("h3", {}, text.sequence),
          lesson.sequence ? h("p", {}, lesson.sequence) : h("div", { class: "bc-sequence-flow" },
            h("span", {}, mark("rice"), crops.find((crop) => crop.id === "rice")?.name),
            icon("i-arrow-r"),
            h("span", {}, mark("soybean"), crops.find((crop) => crop.id === "soybean")?.name)),
          course.id === "rotation" && index === 2 ? h("p", {}, text.sequenceNote) : null) : null,
        form,
        reward,
        h("div", { class: "bc-actions" },
          index > 0 ? h("a", { class: "btn light", href: `#/bootcamp/leccion/${course.id}/${index}` },
            icon("i-back"), text.previous) : null,
          next,
        ),
      );
      updatePath();
      if (moveFocus) title.focus();
    }

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

    const hero = h("header", { class: "bc-hero" },
        h("div", { class: "bc-intro" },
          h("p", { class: "bc-kicker" }, text.meta),
          h("h1", { class: "display" }, text.title),
          h("p", {}, text.intro),
          h("div", { class: "bc-hero-actions" },
            h("a", { class: "btn bc-start", href: "#/bootcamp/capsulas" },
              startLabel, icon("i-arrow-r")),
            h("a", { class: "btn bc-crop-entry", href: "#/bootcamp/cultivos" },
              icon("i-leaf"), text.exploreCrops),
          ),
        ),
        h("figure", {},
          h("img", { src: "img/illu/maize-clean.png", alt: "" }),
        ));
    const courseResources = h("section", { class: "bc-resources", "aria-labelledby": "bc-courses-title" },
        h("div", { class: "bc-section-heading" },
          h("p", { class: "bc-kicker" }, text.coursesKicker),
          h("h2", { class: "display", id: "bc-courses-title" }, text.courses),
          h("p", {}, text.coursesIntro)),
        h("ul", { class: "bc-resource-cards" }, text.resources.map(([provider, name, description, url], index) =>
          h("li", { class: "card" },
            h("span", { class: "bc-resource-icon" }, icon(["i-sprout", "i-leaf", "i-waves"][index])),
            h("p", { class: "bc-kicker" }, provider),
            h("h3", {}, external(name, url)),
            h("p", {}, description),
            h("a", { class: "bc-course-link", href: url, target: "_blank", rel: "noopener noreferrer" }, text.visitCourse, icon("i-arrow-r")),
          ))));
    const cropCatalog = h("section", { class: "bc-catalog", "aria-labelledby": "bc-crops-title" },
        h("header", {}, cropTitle, h("p", {}, text.cropIntro)),
        h("ul", { class: "bc-crop-grid" }, cropCards),
        h("div", { class: "bc-sequence" },
          h("h3", {}, icon("i-leaf"), " ", text.straw),
          h("p", {}, text.strawNote)));
    const allCoursesComplete = courses.every(courseDone);
    const reviewPrompt = (course && courseDone(course)) || allCoursesComplete
      ? h("aside", { class: "bc-review-prompt" },
        h("span", { class: "tile-i dark" }, icon("i-leaf")),
        h("div", {}, h("b", {}, text.reviewTitle), h("p", {}, text.reviewRecommend)),
        h("a", { class: "btn lime", href: "#/bootcamp/cultivos" }, text.exploreCrops, icon("i-arrow-r")),
      )
      : null;

    if (section === "cultivos") return h("div", { class: "bootcamp bootcamp-crops" },
      h("div", { class: "bc-subnav" },
        h("a", { class: "btn light", href: "#/bootcamp" }, icon("i-back"), text.backToHome),
        h("a", { class: "btn light", href: "#/bootcamp/capsulas" }, icon("i-sprout"), text.backToLessons)),
      illustratedHeader({ id: "pests" }, text.cropGuideKicker, text.cropPageTitle, text.cropGuideIntro),
      cropCatalog,
    );

    if (section === "capsulas") return h("div", { class: "bootcamp bootcamp-paths" },
      h("div", { class: "bc-subnav" },
        h("a", { class: "btn light", href: "#/bootcamp" }, icon("i-back"), text.backToHome)),
      illustratedHeader({ id: "soil" }, text.meta, text.pathsTitle, text.pathsIntro),
      allCoursesComplete ? reviewPrompt : null,
      h("div", { class: "bc-path-cards" }, ...courses.map((item, index) => {
        const p = progressFor(item.id), total = item.lessons.length, done = p.completed.length;
        const questions = questionsInCourse(item);
        return h("a", { class: "bc-path-card", href: `#/bootcamp/curso/${item.id}`, style: { "--bc-accent": art(item.id).accent, "--bc-tint": art(item.id).tint } },
          h("img", { class: "bc-path-image", src: art(item.id).image, alt: "", loading: "lazy" }),
          h("span", { class: "bc-path-number" }, String(index + 1).padStart(2, "0")),
          h("div", { class: "bc-path-card-main" },
            h("div", { class: "bc-path-card-title" }, h("h2", {}, item.title), courseDone(item) ? h("span", { class: "bc-complete-tag" }, icon("i-check"), text.courseCompleted) : null),
            h("p", {}, item.description),
            h("div", { class: "bc-path-stats" }, h("span", {}, text.lessonCount(total)), h("span", {}, text.questionCount(questions)), h("span", {}, text.minutes(item.duration))),
            h("div", { class: "bc-path-progress" }, h("span", {}, text.progress(done, total)), h("progress", { max: total, value: done, "aria-label": text.progress(done, total) }))),
          icon("i-arrow-r"),
        );
      })),
      h("div", { class: "bc-path-footer" },
        h("a", { class: "btn light", href: "#/bootcamp/cultivos" }, icon("i-leaf"), text.exploreCrops),
        h("a", { class: "btn light", href: "#/bootcamp" }, icon("i-back"), text.backToHome)),
    );

    if (section === "curso" && course) {
      const p = progress, total = course.lessons.length, done = p.completed.length;
      const firstIncomplete = course.lessons.findIndex((_, index) => !isComplete(index));
      const startIndex = firstIncomplete < 0 ? 0 : firstIncomplete;
      const lessonHref = `#/bootcamp/leccion/${course.id}/${startIndex + 1}`;
      const stats = h("div", { class: "bc-course-stat-grid" },
        h("div", {}, h("b", {}, total), h("span", {}, text.courseLessons)),
        h("div", {}, h("b", {}, questionsInCourse(course)), h("span", {}, text.courseQuestions)),
        h("div", {}, h("b", {}, text.minutes(course.duration)), h("span", {}, text.courseTime)),
      );
      const objectiveItems = course.outcomes.map((outcome) =>
        h("li", {}, icon("i-check"), outcome),
      );
      const objectives = h("section", {},
        h("h2", {}, text.courseObjectives),
        h("ul", { class: "bc-outcomes" }, ...objectiveItems),
      );
      const lessonItems = course.lessons.map((lesson, index) =>
        h("li", { class: isComplete(index) ? "done" : "" },
          h("span", { class: "bc-outline-step" }, isComplete(index) ? icon("i-check") : String(index + 1).padStart(2, "0")),
          h("span", {},
            h("b", {}, lesson.title),
            h("small", {}, text.questionCount(lesson.questions.length)),
          ),
        ),
      );
      const outline = h("section", {},
        h("h2", {}, text.courseContents),
        h("ol", { class: "bc-outline" }, ...lessonItems),
      );
      const progressPanel = h("div", { class: "bc-course-progress" },
        h("div", {},
          h("b", {}, text.courseProgress),
          h("span", {}, text.progress(done, total)),
        ),
        h("progress", { max: total, value: done }),
      );
      const startButton = h("a", { class: "btn dark bc-course-start", href: lessonHref },
        courseDone(course) ? text.reviewCourse : done ? text.continueCourse : text.startCourse,
        icon("i-arrow-r"),
      );
      return h("div", { class: "bootcamp bootcamp-course-dashboard" },
        h("div", { class: "bc-subnav" },
          h("a", { class: "btn light", href: "#/bootcamp/capsulas" }, icon("i-back"), text.backToCourses),
          h("a", { class: "btn light", href: "#/bootcamp/cultivos" }, icon("i-leaf"), text.exploreCrops)),
        illustratedHeader(course, text.courseLabel, course.title, course.description),
        reviewPrompt,
        h("section", { class: "bc-course-overview" },
          stats,
          h("div", { class: "bc-course-columns" },
            h("div", { class: "bc-overview-left" }, objectives, progressPanel, startButton),
            outline),
        ),
      );
    }

    if (section === "leccion" && course) {
      const total = course.lessons.length;
      const requestedIndex = Math.max(0, Math.min(total - 1, (+lessonNumber || 1) - 1));
      const firstIncomplete = course.lessons.findIndex((_, index) => !isComplete(index));
      const unlockedThrough = firstIncomplete < 0 ? total - 1 : firstIncomplete;
      if (requestedIndex > unlockedThrough && !isComplete(requestedIndex)) {
        return h("div", { class: "bootcamp bootcamp-course-dashboard" },
          h("a", { class: "btn light", href: "#/bootcamp/curso/" + course.id }, icon("i-back"), text.backToCourse),
          h("p", { class: "bc-locked-notice", role: "status" }, text.courseLocked));
      }
      renderLesson(requestedIndex);
      return h("div", { class: "bootcamp bootcamp-lessons" },
        h("div", { class: "bc-subnav" },
          h("a", { class: "btn light", href: `#/bootcamp/curso/${course.id}` }, icon("i-back"), text.backToCourse),
          h("div", { class: "bc-subnav-actions" },
            h("span", { class: "bc-kicker" }, course.title),
            h("a", { class: "btn light", href: "#/bootcamp/cultivos" }, icon("i-leaf"), text.exploreCrops))),
        h("div", { class: "bc-course" },
          h("aside", { class: "bc-sidebar" }, count, meter, path),
          card),
      );
    }

    return h("div", { class: "bootcamp bootcamp-home" }, hero, courseResources);
  };
}
