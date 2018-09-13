import { ResponsePath } from "graphql";

export function buildPath(path: ResponsePath) {
  let current: ResponsePath | undefined = path;
  const segments = [];

  while (current != null) {
    if (typeof current.key === "number") {
      segments.push(`[${current.key}]`);
    } else {
      segments.push(current.key);
    }

    current = current.prev;
  }

  return segments.reverse().join(".");
}
