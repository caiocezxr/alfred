const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export function Roll({ value, className = '' }: { value: number | string; className?: string }) {
  const str = String(value)
  return (
    <span className={`wk-roll ${className}`}>
      <span className="wk-sr">{str}</span>
      {[...str].map((ch, i) => {
        const key = str.length - i
        if (!/\d/.test(ch))
          return (
            <span key={`c${key}`} aria-hidden="true">
              {ch}
            </span>
          )
        return (
          <span key={`d${key}`} className="wk-roll-d" aria-hidden="true">
            <span className="wk-roll-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {DIGITS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}
