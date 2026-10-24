import { createQuestion } from "../application/create-question";

export const handle = (stem: string) => createQuestion(stem);
