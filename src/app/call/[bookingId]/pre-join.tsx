"use client";

/**
 * Pre-join screen — camera/mic preview + device picker + username field.
 * Wraps the SDK's `<PreJoin>` so we can apply brand styles (dark, gold)
 * and clamp the UI inside our call layout.
 */
import { PreJoin as LkPreJoin, type LocalUserChoices } from "@livekit/components-react";

export function PreJoin({
  onSubmit,
  onError,
  defaults,
}: {
  onSubmit: (values: LocalUserChoices) => void;
  onError: (error: Error) => void;
  defaults?: { username?: string; videoEnabled?: boolean; audioEnabled?: boolean };
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div
        data-testid="pre-join"
        className="w-full max-w-md rounded-2xl border border-gold/20 bg-[#0A0506] p-6 shadow-glow"
      >
        <p className="font-heading text-lg text-gold">Get ready for the call</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your camera and mic before joining.
        </p>
        <div className="mt-4 [&_button]:bg-burgundy [&_button]:text-foreground [&_button]:hover:bg-burgundy/90 [&_input]:border-gold/30 [&_input]:bg-black/40 [&_input]:text-foreground">
          <LkPreJoin
            onSubmit={(values) =>
              onSubmit({
                ...values,
                username: values.username ?? defaults?.username ?? "Guest",
                videoEnabled: values.videoEnabled,
                audioEnabled: values.audioEnabled,
              })
            }
            onError={onError}
            defaults={{
              username: defaults?.username ?? "Guest",
              videoEnabled: defaults?.videoEnabled ?? true,
              audioEnabled: defaults?.audioEnabled ?? true,
            }}
            joinLabel="Join call"
            userLabel="Display name"
            micLabel="Microphone"
            camLabel="Camera"
          />
        </div>
      </div>
    </div>
  );
}
