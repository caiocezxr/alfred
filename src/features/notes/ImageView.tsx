import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { loadAsset, peekAsset } from './assets'
import { Icon } from './icons'

export function ImageView({ node, selected }: ReactNodeViewProps) {
  const id = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  const [src, setSrc] = useState(() => (id ? peekAsset(id) : undefined))
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true
    setFailed(false)
    loadAsset(id).then(
      (u) => alive && setSrc(u),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [id])

  return (
    <NodeViewWrapper className={`notes-figure ${selected ? 'is-selected' : ''}`} data-drag-handle="">
      {!id || failed ? (
        <div className="notes-figure-missing" contentEditable={false}>
          <Icon name="alert" />
          <span>{id ? 'Imagem indisponível' : 'Imagem externa não importada'}</span>
        </div>
      ) : (
        <>
          {!ready && <div className="notes-figure-skeleton" aria-hidden="true" />}
          {src && (
            <img
              src={src}
              alt={alt}
              draggable={false}
              className={ready ? 'is-ready' : ''}
              onLoad={() => setReady(true)}
              onError={() => setFailed(true)}
            />
          )}
        </>
      )}
    </NodeViewWrapper>
  )
}
