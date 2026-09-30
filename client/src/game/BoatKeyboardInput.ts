const GAME_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

export class BoatKeyboardInput {
  private readonly pressedKeys = new Set<string>();

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearKeys);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  readInto(target: { throttle: number; steering: number }): void {
    const forward = this.pressedKeys.has("w") || this.pressedKeys.has("arrowup");
    const reverse = this.pressedKeys.has("s") || this.pressedKeys.has("arrowdown");
    const left = this.pressedKeys.has("a") || this.pressedKeys.has("arrowleft");
    const right = this.pressedKeys.has("d") || this.pressedKeys.has("arrowright");
    target.throttle = Number(forward) - Number(reverse);
    target.steering = right === left ? 0 : right ? 1 : -1;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.pressedKeys.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!GAME_KEYS.has(key) || isTypingTarget(event.target)) return;
    this.pressedKeys.add(key);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!GAME_KEYS.has(key)) return;
    this.pressedKeys.delete(key);
    event.preventDefault();
  };

  private readonly clearKeys = (): void => {
    this.pressedKeys.clear();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clearKeys();
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
