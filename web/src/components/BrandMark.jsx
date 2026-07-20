// Brand mark: a dashboard — panel tiles plus a metrics bar-chart — depicting the
// app's purpose (an analytics dashboard for Azure DevOps PRs + builds), distinct
// from the git/PR icons used for PR features. Monochrome (inherits currentColor)
// so it themes with light/dark; the favicon/app icon use the same geometry in
// white on the blue→purple brand gradient. `strokeWidth` is accepted for API
// compatibility but unused (the mark is filled).
export function BrandMark({ size = 24, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* dashboard panels */}
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      {/* metrics bar-chart in the fourth panel */}
      <rect x="13.5" y="17.5" width="1.7" height="3.5" rx="0.5" />
      <rect x="16.4" y="15.5" width="1.7" height="5.5" rx="0.5" />
      <rect x="19.3" y="13.5" width="1.7" height="7.5" rx="0.5" />
    </svg>
  );
}
