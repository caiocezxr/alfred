export function Wallpaper() {
  return (
    <div className="wallpaper" aria-hidden="true">
      <div className="wallpaper-layer" style={{ background: 'var(--backdrop)' }} />
      <div className="wallpaper-grain" />
    </div>
  )
}
