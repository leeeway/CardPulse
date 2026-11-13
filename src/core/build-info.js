// Vite injects the same metadata that it emits as build-info.json.
export const buildInfo =
  typeof __CARDPULSE_BUILD__ === 'undefined' ? null : __CARDPULSE_BUILD__;

export function buildReport(info, runtime) {
  return JSON.stringify(
    {
      format: info.format,
      schemaVersion: info.schemaVersion,
      version: info.version,
      revision: info.revision,
      dirty: info.dirty,
      builtAt: info.builtAt,
      mode: info.mode,
      runtime,
    },
    null,
    2,
  );
}
