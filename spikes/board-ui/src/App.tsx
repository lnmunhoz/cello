import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react"
import { useEffect, useState } from "react"
import { Kanban, KanbanCard, KanbanColumn } from "./kanban"
import { CARDS, COLUMNS, store, useLists } from "./store"
import { onToast, scenarios, useVisual, userGrab, type Hole } from "./agents"

const labels = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]))
const order = COLUMNS.map((c) => c.id)
const layoutTransition = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const

function GrabWatcher({ movingKey }: { movingKey: string | null }) {
  // Keyboard pickups (and pointer ones) reach the animator here.
  useEffect(() => userGrab(movingKey), [movingKey])
  return null
}

function CardBody({ id }: { id: string }) {
  const card = CARDS[id]
  return (
    <>
      <span className="card-title">{card.title}</span>
      <span className="card-meta">
        <i style={{ background: card.tone }} />
        {card.tag} · {card.id}
      </span>
    </>
  )
}

/** Cards in a column, with agent "holes" (static copies of cards still shown in their old slot) put back. */
function withHoles(cards: string[], holes: Hole[]) {
  const keys: { key: string; hole?: Hole }[] = cards.map((key) => ({ key }))
  let left = [...holes]
  for (let progress = true; left.length && progress; ) {
    progress = false
    left = left.filter((h) => {
      const at = h.after === null ? 0 : keys.findIndex((k) => k.key === h.after) + 1
      if (h.after !== null && at === 0) return true
      keys.splice(at, 0, { key: h.card, hole: h })
      progress = true
      return false
    })
  }
  for (const h of left) keys.splice(Math.min(keys.length, h.index), 0, { key: h.card, hole: h })
  return keys
}

function CardView({ id, pending }: { id: string; pending?: "queued" | "flying" }) {
  return (
    <KanbanCard
      value={id}
      data-card-id={id}
      data-pending={pending}
      onPointerDownCapture={() => userGrab(id)}
      className="card"
      render={(props) => <motion.div {...(props as object)} layout="position" transition={layoutTransition} />}
    >
      <CardBody id={id} />
    </KanbanCard>
  )
}

function Toasts() {
  const [toasts, setToasts] = useState<{ id: string; text: string; color: string }[]>([])
  useEffect(
    () =>
      onToast((t) => {
        setToasts((ts) => [...ts.filter((x) => x.id !== t.id), t])
        window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 2600)
      }),
    []
  )
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            data-toast
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            <i style={{ background: t.color }} />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function App() {
  const lists = useLists()
  const visual = useVisual()
  return (
    <MotionConfig reducedMotion="user">
      <div className="page">
        <header className="bar">
          <h1>Cello</h1>
          <div className="controls">
            <button onClick={() => scenarios.single()}>Claude moves a card</button>
            <button onClick={() => scenarios.parallel()}>Two agents at once</button>
            <button onClick={() => scenarios.sameCard()}>Same card, two agents</button>
            <button onClick={() => scenarios.burst()}>Burst of 20</button>
          </div>
        </header>
        <LayoutGroup>
          <Kanban lists={lists} onListsChange={(next) => store.set(next)} labels={labels} order={order} aria-label="Board" className="board">
            {({ movingKey }) => (
              <>
                <GrabWatcher movingKey={movingKey} />
                {COLUMNS.map((col) => {
                  const holes = [...visual.holes.values()].filter((h) => h.column === col.id)
                  return (
                    <section key={col.id} className="lane" data-column={col.id} aria-labelledby={`h-${col.id}`}>
                      <h2 id={`h-${col.id}`}>
                        {col.label}
                        <span>{lists[col.id]?.length ?? 0}</span>
                      </h2>
                      <KanbanColumn value={col.id} className="lane-cards" aria-labelledby={`h-${col.id}`}>
                        {({ cards }) =>
                          withHoles(cards, holes).map(({ key, hole }) =>
                            hole ? (
                              <motion.div
                                key={`hole-${hole.id}`}
                                layout="position"
                                transition={layoutTransition}
                                className="card"
                                data-hole={hole.id}
                                data-hole-card={hole.card}
                                style={{ visibility: hole.hidden ? "hidden" : undefined }}
                                onPointerDown={() => userGrab(hole.card)}
                                aria-hidden
                              >
                                <CardBody id={hole.card} />
                              </motion.div>
                            ) : (
                              <CardView key={key} id={key} pending={visual.pending.get(key)} />
                            )
                          )
                        }
                      </KanbanColumn>
                    </section>
                  )
                })}
              </>
            )}
          </Kanban>
        </LayoutGroup>
        <Toasts />
      </div>
    </MotionConfig>
  )
}
