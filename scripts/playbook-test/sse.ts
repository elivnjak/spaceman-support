export type SseEvent = {
  event: string;
  data: string;
};

export function parseSsePayload(payload: string): SseEvent[] {
  const chunks = payload
    .split(/\r?\n\r?\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const events: SseEvent[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split(/\r?\n/g);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    events.push({
      event,
      data: dataLines.join("\n"),
    });
  }

  return events;
}

export function getLastEventData<T>(events: SseEvent[], eventName: string): T | null {
  const match = [...events].reverse().find((event) => event.event === eventName);
  if (!match) return null;
  return JSON.parse(match.data) as T;
}
