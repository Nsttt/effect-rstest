import { Clock, Context, Duration, Effect, Equal, Fiber, Hash, Layer, Schema } from "effect"
import { addEqualityTesters, afterAll, assert, describe, expect, it, layer, makeMethods } from "effect-rstest"
import * as testAssert from "effect-rstest/utils"
import { FastCheck, TestClock } from "effect/testing"

it.effect(
  "effect",
  () => Effect.acquireRelease(Effect.sync(() => expect(1).toEqual(1)), () => Effect.void)
)
it.live(
  "live",
  () => Effect.acquireRelease(Effect.sync(() => expect(1).toEqual(1)), () => Effect.void)
)

it("throws fails when the thunk does not throw", () => {
  expect(() => testAssert.throws(() => {})).toThrow()
})

it("throwsAsync fails when the promise resolves", async () => {
  await expect(testAssert.throwsAsync(() => Promise.resolve())).rejects.toThrow()
})

it("registers Effect equality testers", () => {
  class Token implements Equal.Equal {
    constructor(readonly id: number, readonly label: string) {}

    [Equal.symbol](that: Equal.Equal): boolean {
      return that instanceof Token && this.id === that.id
    }

    [Hash.symbol](): number {
      return this.id
    }
  }

  const left = new Token(1, "left")
  const right = new Token(1, "right")

  expect(left).not.toEqual(right)
  addEqualityTesters()
  expect(left).toEqual(right)
})

it.effect.each([1, 2, 3])(
  "effect each %s",
  (n) => Effect.acquireRelease(Effect.sync(() => expect(n).toEqual(n)), () => Effect.void)
)
it.live.each([1, 2, 3])(
  "live each %s",
  (n) => Effect.acquireRelease(Effect.sync(() => expect(n).toEqual(n)), () => Effect.void)
)

it.live.skip(
  "live skipped",
  () => Effect.die("skipped anyway")
)
it.effect.skip(
  "effect skipped",
  () => Effect.die("skipped anyway")
)

it.effect.skipIf(true)("effect skipIf (true)", () => Effect.die("skipped anyway"))
it.effect.skipIf(false)("effect skipIf (false)", () => Effect.sync(() => expect(1).toEqual(1)))

it.effect.runIf(true)("effect runIf (true)", () => Effect.sync(() => expect(1).toEqual(1)))
it.effect.runIf(false)("effect runIf (false)", () => Effect.die("not run anyway"))

describe.each(["foo", "bar"] as const)("describe.each %s", (text) => {
  it.effect("runs an Effect test", () =>
    Effect.sync(() => {
      assert.include(["foo", "bar"], text)
    }))
})

it.skip.each([1])("skip.each %s", () => assert.fail("skipped anyway"))

let skippedLayerAcquired = false
makeMethods(it.skip).layer(Layer.effectDiscard(Effect.sync(() => skippedLayerAcquired = true)))((it) => {
  it.effect("does not acquire a skipped layer", () => Effect.die("skipped anyway"))
})

afterAll(() => assert.isFalse(skippedLayerAcquired))

// The following test is expected to fail because it simulates a test timeout.
// Be aware that eventual "failure" of the test is only logged out.
it.live.fails("interrupts on timeout", (ctx) =>
  Effect.gen(function*() {
    let acquired = false

    ctx.onTestFailed(() => {
      if (acquired) {
        // oxlint-disable-next-line no-console
        console.error("'effect is interrupted on timeout' effect-rstest test failed")
      }
    })

    yield* Effect.acquireRelease(
      Effect.sync(() => acquired = true),
      () => Effect.sync(() => acquired = false)
    )
    yield* Effect.sleep(1000)
  }), 1)

class Foo extends Context.Service<Foo, "foo">()("Foo") {
  static layer = Layer.succeed(Foo)("foo")
}

class Bar extends Context.Service<Bar, "bar">()("Bar") {
  static layer = Layer.effect(Bar)(Effect.map(Foo, () => "bar" as const))
}

class Sleeper extends Context.Service<Sleeper, {
  readonly sleep: (ms: number) => Effect.Effect<void>
}>()("Sleeper") {
  static readonly layer = Layer.effect(Sleeper)(
    Effect.gen(function*() {
      const clock = yield* Clock.Clock

      return {
        sleep: (ms: number) => clock.sleep(Duration.millis(ms))
      }
    })
  )
}

describe("layer", () => {
  layer(Foo.layer)((it) => {
    it.effect("adds context", () =>
      Effect.gen(function*() {
        const foo = yield* Foo
        expect(foo).toEqual("foo")
      }))

    it.layer(Bar.layer)("nested", (it) => {
      it.effect("adds context", () =>
        Effect.gen(function*() {
          const foo = yield* Foo
          const bar = yield* Bar
          expect(foo).toEqual("foo")
          expect(bar).toEqual("bar")
        }))
    })

    it.layer(Bar.layer)((it) => {
      it.effect("without name", () =>
        Effect.gen(function*() {
          const foo = yield* Foo
          const bar = yield* Bar
          expect(foo).toEqual("foo")
          expect(bar).toEqual("bar")
        }))
    })

    describe("release", () => {
      let released = false
      afterAll(() => {
        expect(released).toEqual(true)
      })

      class Scoped extends Context.Service<Scoped, "scoped">()("Scoped") {
        static layer = Layer.effect(Scoped)(
          Effect.acquireRelease(
            Effect.succeed("scoped" as const),
            () => Effect.sync(() => released = true)
          )
        )
      }

      it.layer(Scoped.layer)((it) => {
        it.effect("adds context", () =>
          Effect.gen(function*() {
            const foo = yield* Foo
            const scoped = yield* Scoped
            expect(foo).toEqual("foo")
            expect(scoped).toEqual("scoped")
          }))
      })

      it.effect.prop(
        "adds context",
        [realNumber],
        ([num]) =>
          Effect.gen(function*() {
            const foo = yield* Foo
            expect(foo).toEqual("foo")
            return num === num
          }),
        { fastCheck: { numRuns: 200 } }
      )

      it.effect.prop(
        "adds context with a Schema property",
        [Schema.Int],
        ([value]) =>
          Effect.gen(function*() {
            const foo = yield* Foo
            assert.strictEqual(foo, "foo")
            assert.isTrue(Number.isInteger(value))
          }),
        { fastCheck: { numRuns: 5, seed: 1001 } }
      )
    })
  })

  layer(Sleeper.layer)("test services", (it) => {
    it.effect("TestClock", () =>
      Effect.gen(function*() {
        const sleeper = yield* Sleeper
        const fiber = yield* Effect.forkChild(sleeper.sleep(100_000))
        yield* Effect.yieldNow
        yield* TestClock.adjust(100_000)
        yield* Fiber.join(fiber)
      }))
  })

  layer(Foo.layer)("with a name", (it) => {
    describe("with a nested describe", () => {
      it.effect("adds context", () =>
        Effect.gen(function*() {
          const foo = yield* Foo
          expect(foo).toEqual("foo")
        }))
    })
    it.effect("adds context", () =>
      Effect.gen(function*() {
        const foo = yield* Foo
        expect(foo).toEqual("foo")
      }))
  })

  layer(Sleeper.layer, { excludeTestServices: true })("live services", (it) => {
    it.effect("Clock", () =>
      Effect.gen(function*() {
        const sleeper = yield* Sleeper
        yield* sleeper.sleep(1)
      }))
  })
})

describe("anonymous layer timeout cleanup", () => {
  let released = false

  const scopedLayer = Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.void,
      () => Effect.sync(() => released = true)
    )
  )

  layer(scopedLayer)((it) => {
    it.effect.fails("runs finalizers after timeout", () => Effect.never, 1)
  })

  it("closes before the next sibling", () => {
    assert.isTrue(released)
  })

  afterAll(() => {
    assert.isTrue(released)
  })
})

describe("anonymous parent layer lifetime", () => {
  let acquisitions = 0
  let released = false
  let parentId = 0

  class Parent extends Context.Service<Parent, { readonly id: number }>()("Parent") {}

  const parentLayer = Layer.effect(Parent)(
    Effect.acquireRelease(
      Effect.sync(() => ({ id: ++acquisitions })),
      () => Effect.sync(() => released = true)
    )
  )

  layer(parentLayer)((it) => {
    it.effect("uses the parent layer", () =>
      Effect.gen(function*() {
        const parent = yield* Parent
        parentId = parent.id
        assert.isFalse(released)
      }))

    it.layer(Layer.effectDiscard(Parent))("nested layer", (it) => {
      it.effect("keeps the parent layer alive", () =>
        Effect.gen(function*() {
          const parent = yield* Parent
          assert.strictEqual(parent.id, parentId)
          assert.isFalse(released)
        }))
    })
  })

  afterAll(() => {
    assert.strictEqual(acquisitions, 1)
    assert.isTrue(released)
  })
})

const realNumber = Schema.Finite
const textArbitrary = FastCheck.constantFrom("a" as const, "b" as const)

it.prop(
  "schema with array",
  [Schema.String, Schema.Int],
  ([text, count]) => typeof text === "string" && Number.isInteger(count)
)

it.prop(
  "schema with object",
  { text: Schema.String, count: Schema.Int },
  ({ text, count }) => typeof text === "string" && Number.isInteger(count)
)

it.prop(
  "rejects Promise-returning synchronous properties",
  [Schema.Int],
  (() => Promise.resolve(true)) as unknown as () => boolean,
  { fails: true, fastCheck: { numRuns: 1 } }
)

let mixedTupleRuns = 0
let mixedRecordRuns = 0
afterAll(() => {
  assert.strictEqual(mixedTupleRuns, 5)
  assert.strictEqual(mixedRecordRuns, 5)
})

it.prop(
  "Schema and Arbitrary with array",
  [Schema.Int, textArbitrary],
  ([count, text]) => {
    mixedTupleRuns++
    assert.isTrue(Number.isInteger(count))
    assert.include(["a", "b"], text)
  },
  { fastCheck: { numRuns: 5, seed: 1002 } }
)

it.effect.prop(
  "Schema and Arbitrary with object",
  { count: Schema.Int, text: textArbitrary },
  ({ count, text }) =>
    Effect.sync(() => {
      mixedRecordRuns++
      assert.isTrue(Number.isInteger(count))
      assert.include(["a", "b"], text)
    }),
  { fastCheck: { numRuns: 5, seed: 1003 } }
)

it.prop("symmetry", [realNumber, Schema.Int], ([a, b]) => a + b === b + a)

it.prop(
  "symmetry with object",
  { a: realNumber, b: Schema.Int },
  ({ a, b }) => a + b === b + a
)

it.live.prop(
  "schema with object",
  { value: Schema.Int },
  ({ value }) => Effect.sync(() => assert.isTrue(Number.isInteger(value)))
)

let arbitraryEffectRuns = 0
afterAll(() => assert.strictEqual(arbitraryEffectRuns, 5))

it.effect.prop(
  "schema with Arbitrary options",
  [Schema.String, Schema.Int],
  ([text, count]) =>
    Effect.sync(() => {
      arbitraryEffectRuns++
      assert.strictEqual(typeof text, "string")
      assert.isTrue(Number.isInteger(count))
    }),
  { fastCheck: { numRuns: 5, seed: 1004 } }
)

it.effect.prop("symmetry", [realNumber, Schema.Int], ([a, b]) =>
  Effect.gen(function*() {
    yield* Effect.void
    assert.isTrue(a + b === b + a)
  }))

it.effect.prop("symmetry with object", { a: realNumber, b: Schema.Int }, ({ a, b }) =>
  Effect.gen(function*() {
    yield* Effect.void
    assert.strictEqual(a + b, b + a)
  }))

it.effect.prop(
  "should detect the substring",
  { a: Schema.String, b: Schema.String, c: Schema.String },
  ({ a, b, c }) =>
    Effect.gen(function*() {
      yield* Effect.scope
      assert.include(a + b + c, b)
    })
)

describe("property failures", () => {
  const Input = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))
  const pureDefectValues: Array<number> = []
  const effectDefectValues: Array<number> = []
  let interruptedRuns = 0
  let timeoutPropertyStarted = false
  let timeoutPropertyReleased = false

  afterAll(() => {
    assert.deepStrictEqual(pureDefectValues, [8, 1])
    assert.deepStrictEqual(effectDefectValues, [8, 1])
    assert.isAtLeast(interruptedRuns, 1)
    assert.isTrue(timeoutPropertyStarted)
    assert.isTrue(timeoutPropertyReleased)
  })

  it.prop(
    "shrinks synchronous defects",
    [Input],
    ([value]) => {
      pureDefectValues.push(value)
      throw new Error("property defect")
    },
    { fails: true, fastCheck: { numRuns: 1, seed: 1005 } }
  )

  it.effect.prop(
    "shrinks Effect defects",
    [Input],
    ([value]) =>
      Effect.sync(() => {
        effectDefectValues.push(value)
        assert.strictEqual(value, 0)
      }),
    { fails: true, fastCheck: { numRuns: 1, seed: 1005 } }
  )

  it.effect.prop(
    "preserves interruption",
    [Input],
    () => {
      interruptedRuns++
      return Effect.interrupt
    },
    { fails: true, fastCheck: { numRuns: 1, seed: 1005 } }
  )

  it.effect.prop(
    "interrupts property checking on timeout",
    [Schema.Literal("value")],
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          timeoutPropertyStarted = true
        }),
        () => Effect.never,
        () =>
          Effect.sync(() => {
            timeoutPropertyReleased = true
          })
      ),
    { fails: true, timeout: 10, fastCheck: { numRuns: 1, seed: 1006 } }
  )
})
