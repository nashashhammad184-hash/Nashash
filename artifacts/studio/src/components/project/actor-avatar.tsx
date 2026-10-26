/**
 * KAYAN-CINEMA-17B: shared avatar renderer for actor images.
 *
 * Uses GET /api/actors/:actorId/image (server-side authenticated proxy to
 * Supabase Storage). The route requires the session cookie; since it is a
 * same-origin request, the browser sends cookies automatically.
 *
 * Fallback: if the image fails to load (404, 401, network, missing image),
 * renders a User icon instead of a broken image.
 */
import React, { useState } from "react";
import { User } from "lucide-react";

interface ActorAvatarProps {
  actorId: number;
  name?: string;
  /** Square pixel size. */
  size?: number;
  className?: string;
  /** Test-only: force fallback without triggering an actual error event. */
  forceError?: boolean;
}

export function ActorAvatar({
  actorId,
  name,
  size = 48,
  className = "",
  forceError = false,
}: ActorAvatarProps) {
  const [errored, setErrored] = useState(false);
  const showFallback = errored || forceError;

  if (showFallback) {
    return (
      <div
        className={`bg-zinc-800 flex items-center justify-center text-zinc-400 border border-zinc-700 ${className}`}
        style={{ width: size, height: size }}
        data-testid="actor-avatar-fallback"
        aria-label={name ? `No image for ${name}` : `No image for actor ${actorId}`}
      >
        <User style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
      </div>
    );
  }

  return (
    <img
      src={`/api/actors/${actorId}/image`}
      alt={name || `Actor ${actorId}`}
      className={`object-cover ${className}`}
      style={{ width: size, height: size }}
      data-testid="actor-avatar-image"
      onError={() => setErrored(true)}
      loading="lazy"
      decoding="async"
    />
  );
}
