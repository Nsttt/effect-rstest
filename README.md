# effect-rstest

Effect test helpers for [Rstest](https://rstest.rs). This package re-exports `@rstest/core` and adds Effect-aware tests, shared layers, test services, and property testing.

## Installation

```sh
pnpm add -D effect-rstest @rstest/core
```

The initial release targets Effect 4 RC and Rstest 0.11.

## Usage

Use `it.effect` for tests with `TestClock` and `TestConsole`, or `it.live` for the live Effect environment. Both variants create and close a fresh `Scope` for each test.

```ts
import { Effect, Fiber } from "effect"
import { assert, it } from "effect-rstest"
import { TestClock } from "effect/testing"

it.effect("advances virtual time", () =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.sleep(60_000))
    yield* TestClock.adjust(60_000)
    yield* Fiber.join(fiber)
    assert.isTrue(true)
  }))
```

Use `layer` or `it.layer` to share a layer across a group of tests. Named layers accept `concurrent` to override the enclosing suite.

```ts
import { Context, Effect, Layer } from "effect"
import { assert, it } from "effect-rstest"

class Api extends Context.Service<Api, { readonly status: Effect.Effect<number> }>()("Api") {}

const ApiLive = Layer.succeed(Api, { status: Effect.succeed(200) })

it.layer(ApiLive)("api", (it) => {
  it.effect("returns a status", () =>
    Effect.gen(function*() {
      const api = yield* Api
      assert.strictEqual(yield* api.status, 200)
    }))
})
```

Property tests accept Effect `Schema` and FastCheck `Arbitrary` values. They shrink callbacks that return `false`, throw, or fail with a non-interruption cause.

```ts
import { Effect, Schema } from "effect"
import { assert, it } from "effect-rstest"

it.effect.prop(
  "addition is commutative",
  [Schema.Int, Schema.Int],
  ([a, b]) => Effect.sync(() => assert.strictEqual(a + b, b + a))
)
```

Rstest modifiers remain available. Use `it.effect.concurrent`, `it.effect.sequential`, `it.effect.skip`, `it.effect.only`, `it.effect.fails`, `it.effect.skipIf`, and `it.effect.runIf` with Effect tests.

Call `addEqualityTesters()` from an Rstest setup file to make `toEqual` use Effect's `Equal` implementation.

## License

MIT
