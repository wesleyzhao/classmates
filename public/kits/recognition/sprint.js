// Pure scoring for a continuous solo recognition sprint, shared by client and server.

/** Score an exact sequence of four-choice answers; accuracy always outranks speed.
 * @param {Array<{id:string,correctChoice:string}>} questions
 * @param {Array<{questionId:string,choice:string}>} answers
 * @param {number} elapsedMs
 */
export function scoreSprint(questions, answers, elapsedMs) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 600 ||
      !Array.isArray(answers) || answers.length !== questions.length ||
      !Number.isInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > 3600000)
    throw new Error("That sprint result is not valid.");
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i], answer = answers[i];
    if (!question || typeof question.id !== "string" || !/^[0-3]$/.test(question.correctChoice) ||
        !answer || answer.questionId !== question.id || typeof answer.choice !== "string" ||
        !/^[0-3]$/.test(answer.choice))
      throw new Error("That sprint result is not valid.");
    if (answer.choice === question.correctChoice) correct++;
  }
  const count = questions.length;
  const bonus = Math.round(999 * (correct / count) * Math.max(0, 1 - elapsedMs / (count * 8000)));
  return { score: correct * 1000 + bonus, correct, count, elapsedMs, perfect: correct === count };
}
