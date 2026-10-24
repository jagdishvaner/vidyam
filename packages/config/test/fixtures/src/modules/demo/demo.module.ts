// Composition root: allowed to wire every layer together.
import { createQuestion } from "./application/create-question";
import { QuestionRepository } from "./infrastructure/question-repository";
import { handle } from "./interface/question-controller";

export const wiring = { createQuestion, QuestionRepository, handle };
