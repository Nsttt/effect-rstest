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

The test fiber receives Rstest's abort signal. If a test times out, the runner still reports the timeout, but an `onTestFinished` barrier waits for fiber settlement and scoped finalizers before later sequential tests and suite-layer release. The barrier does not impose a second cleanup timeout: a finalizer that never completes can prevent the suite from progressing. Successful non-void Effect values are discarded; ordinary failures and `.fails` outcomes retain their runner semantics.

**Native hook boundary:** Rstest runs native `afterEach` hooks before `onTestFinished`. On timeout, those hooks can run before Effect cleanup finishes; the settlement guarantee does not cover them. It also does not serialize tests explicitly scheduled concurrently.

Use `layer` or `it.layer` to share a layer across a group of tests. Named layers accept `concurrent` to override the enclosing suite.

Rstest's suite hook context has no abort signal. When setup exceeds an explicit layer `timeout`, or the inherited `hookTimeout` when omitted, suite teardown interrupts and awaits the setup fiber before closing its scope. This also releases resources acquired before an early setup failure. The teardown hook retains the same timeout: cleanup that exceeds it can outlive the hook and is not a bounded-cleanup guarantee. Hook failures remain runner failures. Named and unnamed layer blocks use the same lifecycle boundary.

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

Property tests accept Effect `Schema` values and `Arbitrary` values from `effect/unstable/arbitrary`. They shrink callbacks that return `false`, throw, or fail with a non-interruption cause.

```ts
import { Effect, Schema } from "effect"
import { assert, it } from "effect-rstest"

it.effect.prop(
  "addition is commutative",
  [Schema.Int, Schema.Int],
  ([a, b]) => Effect.sync(() => assert.strictEqual(a + b, b + a))
)
```

All three helpers accept tuple and record inputs, mixing schemas and arbitraries. Schemas are converted with `Arbitrary.schema(schema)`; `Arbitrary` values are used directly. For example, a synchronous property can use `[Schema.Literal("schema"), Arbitrary.schema(Schema.Int)]`. A schema must support arbitrary generation. Pass check options as `{ arbitrary: { runs: 200, seed: "repro" } }` (see `Arbitrary.CheckOptions`).

Requires `effect` `4.0.0-rc.113` or later, which removed `effect/testing/FastCheck`. To migrate from 0.1.x, replace `FastCheck.*` inputs with schemas or `Arbitrary` values, and `{ fastCheck: { numRuns } }` with `{ arbitrary: { runs } }`.

Rstest modifiers remain available. Use `it.effect.concurrent`, `it.effect.sequential`, `it.effect.skip`, `it.effect.only`, `it.effect.fails`, `it.effect.skipIf`, and `it.effect.runIf` with Effect tests.

Call `addEqualityTesters()` from an Rstest setup file to opt in. When both compared values implement Effect's `Equal` protocol, the tester delegates to `Equal.equals`, including semantic inequality and nested comparisons. For other values it returns `undefined`, leaving plain-object equality and asymmetric matchers to Rstest. It does not replace Rstest's equality behavior globally.

## License

MIT
