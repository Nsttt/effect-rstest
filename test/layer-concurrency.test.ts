import { Effect, Layer } from "effect"
import { assert, describe, it, layer, type Rstest } from "effect-rstest"

const checkConcurrency = (
  it: Rstest.MethodsNonLive,
  concurrent: boolean
) => {
  let running = 0
  let release!: () => void
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve
  })

  for (const name of ["first", "second"]) {
    it.effect(name, () =>
      Effect.gen(function*() {
        running++
        if (running === 2) release()
        try {
          if (concurrent) {
            yield* Effect.promise(() => bothStarted)
          } else {
            yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
            assert.strictEqual(running, 1)
          }
        } finally {
          running--
        }
      }))
  }
}

for (const [name, makeLayer] of [["layer", layer], ["it.layer", it.layer]] as const) {
  describe(name, () => {
    for (const concurrent of [false, true]) {
      const suite = concurrent ? describe.concurrent : describe.sequential
      suite(`enclosing suite concurrent=${concurrent}`, () => {
        makeLayer(Layer.empty)("named layer inherits", (it) => {
          checkConcurrency(it, concurrent)
        })

        makeLayer(Layer.empty, { concurrent: !concurrent })("named layer overrides", (it) => {
          checkConcurrency(it, !concurrent)

          it.layer(Layer.empty)("nested layer inherits", (it) => {
            checkConcurrency(it, !concurrent)
          })

          it.layer(Layer.empty, { concurrent })("nested layer overrides", (it) => {
            checkConcurrency(it, concurrent)
          })
        })

        describe("anonymous layer", () => {
          makeLayer(Layer.empty, { concurrent: !concurrent })((it) => {
            checkConcurrency(it, concurrent)
          })
        })
      })
    }
  })
}

describe("Effect test modifiers", () => {
  let running = 0
  let release!: () => void
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve
  })

  for (const name of ["first", "second"]) {
    it.effect.concurrent(name, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          running++
          if (running === 2) release()
        }),
        () => Effect.promise(() => bothStarted),
        () => Effect.sync(() => running--)
      ))
  }
})
