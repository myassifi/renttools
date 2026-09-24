/**
 * A calendar-event UID is only unique inside one platform feed. Keep the
 * platform beside it everywhere the frontend pairs a local row with its
 * synced source so identical UIDs from two channels cannot cross-link.
 */
export function calendarEventIdentity(platform: string, uid: string): string {
  return `${platform}\u0000${uid}`;
}

export interface LinkedEventReference {
  platform: string;
  linkedEventUid?: string | null;
  linkedEventPlatform?: string | null;
}

export interface SyncedEventReference {
  platform: string;
  eventUid?: string | null;
}

/**
 * Legacy linked rows stored the source platform in `platform`. New Direct
 * extensions keep their own platform (`direct`) and store the source in
 * `linkedEventPlatform`. The fallback preserves old rows without making a
 * new Direct row guess at a source feed.
 */
export function linkedSourcePlatform(reference: LinkedEventReference): string | undefined {
  if (!reference.linkedEventUid) return undefined;
  if (reference.linkedEventPlatform) return reference.linkedEventPlatform;
  return reference.platform !== "direct" ? reference.platform : undefined;
}

export function referencesSyncedEvent(
  linked: LinkedEventReference,
  source: SyncedEventReference,
): boolean {
  const sourcePlatform = linkedSourcePlatform(linked);
  return !!(
    linked.linkedEventUid &&
    source.eventUid &&
    sourcePlatform &&
    calendarEventIdentity(sourcePlatform, linked.linkedEventUid) ===
      calendarEventIdentity(source.platform, source.eventUid)
  );
}
