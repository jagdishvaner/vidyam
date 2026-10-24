import { Question } from "../domain/question";

export const createQuestion = (stem: string) => new Question(stem);
