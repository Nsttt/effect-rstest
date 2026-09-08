/**
 * @since 0.1.0
 */
import * as R from "@rstest/core"
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type { FastCheck as FC } from "effect/testing"
import * as internal from "./internal/internal.ts"

/**
 * @since 0.1.0
 */
export * from "@rstest/core"

/**
 * @since 0.1.0
 */
export type API = R.TestAPIs

/**
 * @since 0.1.0
 */
export namespace Rstest {
  /**
   * @since 0.1.0
   */
  export interface TestFunction<A, E, R, TestArgs extends Array<any>> {
    (...args: TestArgs): Effect.Effect<A, E, R>
  }

  /**
   * @since 0.1.0
   */
  export interface Test<R> {
    <A, E>(
      name: string,
      self: TestFunction<A, E, R, [R.TestContext]>,
      timeout?: number | R.TestOptions
    ): void
  }

  /**
   * @since 0.1.0
   */
  export type Arbitraries =
    | ReadonlyArray<Schema.Schema<any> | FC.Arbitrary<any>>
    | { [K in string]: Schema.Schema<any> | FC.Arbitrary<any> }

  type ArbitraryValue<A> = A extends Schema.Schema<infer T> ? T
    : A extends FC.Arbitrary<infer T> ? T
    : never

  /**
   * @since 0.1.0
   */
  export interface Tester<R> extends Rstest.Test<R> {
    skip: Rstest.Test<R>
    skipIf: (condition: boolean) => Rstest.Test<R>
    runIf: (condition: boolean) => Rstest.Test<R>
    only: Rstest.Test<R>
    concurrent: Rstest.Test<R>
    sequential: Rstest.Test<R>
    each: <T>(
      cases: ReadonlyArray<T>
    ) => <A, E>(name: string, self: TestFunction<A, E, R, [T]>, timeout?: number | R.TestOptions) => void
    fails: Rstest.Test<R>

    /**
     * Runs an Effectful property test using Schema or Arbitrary inputs.
     *
     * **Details**
     *
     * Returning `false` or completing with any non-interruption failure falsifies the property and triggers shrinking.
     * This includes typed Effect failures, thrown exceptions, interruptions, and defects such as failed assertions.
     *
     * The Rstest timeout interrupts the Effect fiber running generation, property evaluation, and shrinking. Effect
     * finalizers run during that interruption.
     *
     * **Gotchas**
     *
     * A timeout cannot preempt a synchronous JavaScript callback that does not return.
     *
     * @since 0.1.0
     */
    prop: <const Arbs extends Arbitraries, A, E>(
      name: string,
      arbitraries: Arbs,
      self: TestFunction<
        A,
        E,
        R,
        [
          {
            [K in keyof Arbs]: ArbitraryValue<Arbs[K]>
          },
          R.TestContext
        ]
      >,
      timeout?:
        | number
        | R.TestOptions & {
          fastCheck?: FC.Parameters<any>
          fails?: boolean
        }
    ) => void
  }

  /**
   * @since 0.1.0
   */
  export interface MethodsNonLive<R = never> extends API {
    readonly effect: Rstest.Tester<R | Scope.Scope>
    readonly flakyTest: <A, E, R2>(
      self: Effect.Effect<A, E, R2 | Scope.Scope>,
      timeout?: Duration.Input
    ) => Effect.Effect<A, never, R2>
    readonly layer: <R2, E>(layer: Layer.Layer<R2, E, R>, options?: {
      readonly concurrent?: boolean
      readonly timeout?: Duration.Input
    }) => {
      (f: (it: Rstest.MethodsNonLive<R | R2>) => void): void
      (
        name: string,
        f: (it: Rstest.MethodsNonLive<R | R2>) => void
      ): void
    }

    /**
     * Runs a synchronous property test using Schema or Arbitrary inputs.
     *
     * **Details**
     *
     * Returning `false` or throwing falsifies the property and triggers shrinking. A callback that returns normally
     * without returning `false` passes for that generated input.
     *
     * The Rstest timeout interrupts the Effect fiber running generation and shrinking.
     *
     * **Gotchas**
     *
     * A timeout cannot preempt a synchronous JavaScript callback that does not return.
     *
     * @since 0.1.0
     */
    readonly prop: <const Arbs extends Arbitraries>(
      name: string,
      arbitraries: Arbs,
      self: (
        properties: {
          [K in keyof Arbs]: ArbitraryValue<Arbs[K]>
        },
        ctx: R.TestContext
      ) => boolean | void,
      timeout?:
        | number
        | R.TestOptions & {
          fastCheck?: FC.Parameters<any>
          fails?: boolean
        }
    ) => void
  }

  /**
   * @since 0.1.0
   */
  export interface Methods<R = never> extends MethodsNonLive<R> {
    readonly live: Rstest.Tester<Scope.Scope | R>
    readonly layer: <R2, E>(layer: Layer.Layer<R2, E, R>, options?: {
      readonly concurrent?: boolean
      readonly memoMap?: Layer.MemoMap
      readonly timeout?: Duration.Input
      readonly excludeTestServices?: boolean
    }) => {
      (f: (it: Rstest.MethodsNonLive<R | R2>) => void): void
      (
        name: string,
        f: (it: Rstest.MethodsNonLive<R | R2>) => void
      ): void
    }
  }
}

/**
 * @since 0.1.0
 */
export const addEqualityTesters: () => void = internal.addEqualityTesters

/**
 * @since 0.1.0
 */
export const effect: Rstest.Tester<Scope.Scope> = internal.effect

/**
 * @since 0.1.0
 */
export const live: Rstest.Tester<Scope.Scope> = internal.live

/**
 * Share a `Layer` between multiple tests, optionally wrapping
 * the tests in a `describe` block if a name is provided.
 *
 * Named layers accept `concurrent` to override inherited suite concurrency.
 * Anonymous layers always inherit the enclosing suite's concurrency.
 * Use `ctx.expect` in concurrent tests for test-local snapshots and assertion counts.
 *
 * @since 0.1.0
 *
 * ```ts
 * import { assert, layer } from "effect-rstest"
 * import { Effect, Layer, Context } from "effect"
 *
 * class Foo extends Context.Service<Foo, "foo">()("Foo") {
 *   static layer = Layer.succeed(Foo, "foo")
 * }
 *
 * class Bar extends Context.Service<Bar, "bar">()("Bar") {
 *   static layer = Layer.effect(
 *     Bar,
 *     Effect.map(Foo, () => "bar" as const)
 *   )
 * }
 *
 * layer(Foo.layer)("layer", (it) => {
 *   it.effect("adds context", () =>
 *     Effect.gen(function*() {
 *       const foo = yield* Foo
 *       assert.strictEqual(foo, "foo")
 *     }))
 *
 *   it.layer(Bar.layer)("nested", (it) => {
 *     it.effect("adds context", () =>
 *       Effect.gen(function*() {
 *         const foo = yield* Foo
 *         const bar = yield* Bar
 *         assert.strictEqual(foo, "foo")
 *         assert.strictEqual(bar, "bar")
 *       }))
 *   })
 * })
 * ```
 */
export const layer: <R, E>(
  layer_: Layer.Layer<R, E>,
  options?: {
    readonly concurrent?: boolean
    readonly memoMap?: Layer.MemoMap
    readonly timeout?: Duration.Input
    readonly excludeTestServices?: boolean
  }
) => {
  (f: (it: Rstest.MethodsNonLive<R>) => void): void
  (name: string, f: (it: Rstest.MethodsNonLive<R>) => void): void
} = internal.layer

/**
 * @since 0.1.0
 */
export const flakyTest: <A, E, R>(
  self: Effect.Effect<A, E, R | Scope.Scope>,
  timeout?: Duration.Input
) => Effect.Effect<A, never, R> = internal.flakyTest

/**
 * @since 0.1.0
 */
export const prop: Rstest.Methods["prop"] = internal.prop

/**
 * @since 0.1.0
 */
export const it: Rstest.Methods = internal.makeMethods(R.it)

/**
 * @since 0.1.0
 */
export const makeMethods: (it: R.TestAPIs | R.TestAPIs["skip"]) => Rstest.Methods = internal.makeMethods

/**
 * @since 0.1.0
 */
export const describeWrapped: (name: string, f: (it: Rstest.Methods) => void) => void = internal.describeWrapped
