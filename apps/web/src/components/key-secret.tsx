export function KeySecret({ secret, visible, id, label }: { secret: string | null; visible: boolean; id: string; label: string }) {
  const prefix = secret?.slice(0, 12) ?? "sm_live_";
  const suffix = secret?.slice(prefix.length) ?? "unavailable";

  return <div id={id} className="key-secret-display mono" data-visible={visible} role="text" aria-label={visible && secret ? `${label}: ${secret}` : `${label}: hidden`}>
    <span className="key-secret-prefix" aria-hidden="true">{prefix}</span>
    <span className="key-secret-suffix" aria-hidden="true">
      <span className="key-secret-blurred">{suffix}</span>
      {secret && <span className="key-secret-revealed">{suffix}</span>}
    </span>
  </div>;
}
