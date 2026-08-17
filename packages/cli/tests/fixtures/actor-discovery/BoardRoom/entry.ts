import { formatMessage } from "./lib/helper.js";

export default class BoardRoom {
  handleMessage(message: unknown): string {
    return formatMessage(message);
  }
}
