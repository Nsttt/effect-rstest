/**
 * @since 0.1.0
 */

import * as R from "@rstest/core"
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import { flow, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { FastCheck as FC, TestClock, TestConsole } from "effect/testing"
import type * as Rstest from "../index.ts"

const runPromise: <E, A>(
  _: Effect.Effect<A, E, never>,
  ctx?: R.TestContext | undefined
) => Promise<A> = Effect.fnUntraced(function*<E, A>(effect: Effect.Effect<A, E>, _ctx?: Rstest.TestContext) {
  const exit = yield* Effect.exit(effect)
  if (Exit.isFailure(exit)) {
    const errors = Cause.prettyErrors(exit.cause)
    for (let i = 0; i < errors.length; i++) {
      yield* Effect.logError(errors[i])
    }
  }
  return yield* exit
}, (effect, _, ctx) => Effect.runPromise(effect, { signal: ctx?.signal }))

/** @internal */
const runTest = (ctx?: Rstest.TestContext) => <E, A>(effect: Effect.Effect<A, E>) => runPromise(effect, ctx)

/** @internal */
export type TestContext = TestConsole.TestConsole | TestClock.TestClock

const TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

/** @internal */
export const addEqualityTesters = () => {
  R.expect.addEqualityTesters([
    (a, b) => Equal.isEqual(a) || Equal.isEqual(b) ? Equal.equals(a, b) : undefined
  ])
}

const hookTimeout = (timeout?: Duration.Input) =>
  timeout === undefined ? undefined : Duration.toMillis(Duration.fromInputUnsafe(timeout))

type PropertyOptions = R.TestOptions & {
  readonly fastCheck?: FC.Parameters<any> | undefined
  readonly fails?: boolean | undefined
}

type PropertyTimeout = number | PropertyOptions

/** @internal */
const testOptions = (timeout?: number | R.TestOptions | PropertyOptions): R.TestOptions => {
  if (typeof timeout === "number") {
    return { timeout }
  }
  if (timeout === undefined) {
    return {}
  }
  const { fails: _, fastCheck: __, ...options } = timeout as PropertyOptions
  return options
}

type ArbitraryInput = Schema.Schema<any> | FC.Arbitrary<unknown>

type Arbitraries = ReadonlyArray<ArbitraryInput> | { [K in string]: ArbitraryInput }

const propertyTestOptions = (
  timeout: PropertyTimeout | undefined
): Exclude<PropertyTimeout, number> | undefined => typeof timeout === "number" ? undefined : timeout

const checkOptions = (timeout: PropertyTimeout | undefined): FC.Parameters<any> | undefined =>
  propertyTestOptions(timeout)?.fastCheck

const compileArbitraryInput = (input: ArbitraryInput): FC.Arbitrary<any> =>
  Schema.isSchema(input) ? Schema.toArbitrary(input)(FC) : input as FC.Arbitrary<any>

const makeArbitrary = (arbitraries: Arbitraries): FC.Arbitrary<any> =>
  Array.isArray(arbitraries)
    ? FC.tuple(...arbitraries.map(compileArbitraryInput))
    : FC.record(Object.fromEntries(
      Object.entries(arbitraries).map(([key, input]) => [key, compileArbitraryInput(input)])
    ))

const normalizeProperty = <A, E, R>(
  property: (value: A) => boolean | Effect.Effect<boolean, E, R>,
  value: A
): Effect.Effect<boolean, E | Cause.Cause<E>, R> =>
  Effect.catchCause(
    Effect.suspend(() => {
      const output = property(value)
      if (Predicate.isPromiseLike(output)) {
        throw new TypeError("Effect property tests must return an Effect or boolean")
      }
      return Effect.isEffect(output) ? output : Effect.succeed(output)
    }),
    (cause): Effect.Effect<never, E | Cause.Cause<E>> =>
      Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.fail(cause)
  )

const normalizeSyncProperty = <A>(
  property: (value: A, ctx: R.TestContext) => boolean | void,
  value: A,
  ctx: R.TestContext
): boolean => {
  const output = property(value, ctx)
  if (Predicate.isPromiseLike(output)) {
    throw new TypeError("Synchronous property tests must not return a Promise")
  }
  return output !== false
}

const runCheck = <A, E>(
  ctx: R.TestContext,
  arbitrary: FC.Arbitrary<A>,
  property: (value: A) => boolean | Effect.Effect<boolean, E>,
  options: FC.Parameters<any> | undefined
): Promise<void> =>
  FC.assert(
    FC.asyncProperty(arbitrary, (value) => runTest(ctx)(normalizeProperty(property, value))),
    options
  )

type TestAPI = R.TestAPIs | R.TestAPIs["skip"]

const makeItProxy = <Methods extends object>(
  it: TestAPI,
  overrides: Methods
): Methods & R.TestAPIs =>
  new Proxy(it as Methods & R.TestAPIs, {
    apply(target, thisArg, argArray) {
      return Reflect.apply(target, thisArg, argArray)
    },
    get(target, property, receiver) {
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property)
      }
      // do not bind: binding would strip Rstest's static helpers
      return Reflect.get(target, property, receiver)
    }
  })

/** @internal */
const makeTester = <R>(
  mapEffect: <A, E>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, never>,
  it: TestAPI = R.it
): Rstest.Rstest.Tester<R> => {
  const run = <A, E, TestArgs extends Array<unknown>>(
    ctx: R.TestContext & object,
    args: TestArgs,
    self: Rstest.Rstest.TestFunction<A, E, R, TestArgs>
  ) => pipe(Effect.suspend(() => self(...args)), mapEffect, Effect.asVoid, runTest(ctx))

  const f: Rstest.Rstest.Test<R> = (name, self, timeout) =>
    it(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const skip: Rstest.Rstest.Tester<R>["only"] = (name, self, timeout) =>
    it.skip(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const skipIf: Rstest.Rstest.Tester<R>["skipIf"] = (condition) => (name, self, timeout) =>
    it.skipIf(condition)(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const runIf: Rstest.Rstest.Tester<R>["runIf"] = (condition) => (name, self, timeout) =>
    it.runIf(condition)(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const only: Rstest.Rstest.Tester<R>["only"] = (name, self, timeout) =>
    it.only(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const concurrent: Rstest.Rstest.Tester<R>["concurrent"] = (name, self, timeout) =>
    it.concurrent(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const sequential: Rstest.Rstest.Tester<R>["sequential"] = (name, self, timeout) =>
    it.sequential(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const each: Rstest.Rstest.Tester<R>["each"] = (cases) => (name, self, timeout) => {
    it.for(cases)(
      name,
      testOptions(timeout),
      (args, ctx) => run(ctx, [args], self)
    )
  }

  const fails: Rstest.Rstest.Tester<R>["fails"] = (name, self, timeout) =>
    it.fails(name, testOptions(timeout), (ctx) => run(ctx, [ctx], self))

  const prop: Rstest.Rstest.Tester<R>["prop"] = (name, arbitraries, self, timeout) => {
    const arbitrary = makeArbitrary(arbitraries)
    const testApi = propertyTestOptions(timeout)?.fails ? it.fails : it
    return testApi(
      name,
      testOptions(timeout),
      (ctx) =>
        runCheck(
          ctx,
          arbitrary,
          (values) =>
            Effect.mapEager(
              mapEffect(Effect.suspend(() => self(values as any, ctx))),
              (value) => (value as unknown) !== false
            ),
          checkOptions(timeout)
        )
    )
  }

  return Object.assign(f, { skip, skipIf, runIf, only, concurrent, sequential, each, fails, prop })
}

/** @internal */
const makeProp = (it: TestAPI): Rstest.Rstest.Methods["prop"] => (name, arbitraries, self, timeout) => {
  const arbitrary = makeArbitrary(arbitraries)
  const testApi = propertyTestOptions(timeout)?.fails ? it.fails : it
  return testApi(
    name,
    testOptions(timeout),
    (ctx) =>
      runCheck(
        ctx,
        arbitrary,
        (values) => normalizeSyncProperty(self, values as any, ctx),
        checkOptions(timeout)
      )
  )
}

/** @internal */
export const prop: Rstest.Rstest.Methods["prop"] = makeProp(R.it)

/** @internal */
export const layer = <R, E>(
  layer_: Layer.Layer<R, E>,
  options?: {
    readonly concurrent?: boolean
    readonly memoMap?: Layer.MemoMap
    readonly timeout?: Duration.Input
    readonly excludeTestServices?: boolean
  },
  testApi: TestAPI = R.it
): {
  (f: (it: Rstest.Rstest.MethodsNonLive<R>) => void): void
  (
    name: string,
    f: (it: Rstest.Rstest.MethodsNonLive<R>) => void
  ): void
} =>
(
  ...args: [
    name: string,
    f: (
      it: Rstest.Rstest.MethodsNonLive<R>
    ) => void
  ] | [
    f: (it: Rstest.Rstest.MethodsNonLive<R>) => void
  ]
) => {
  const excludeTestServices = options?.excludeTestServices ?? false
  const withTestEnv = excludeTestServices
    ? layer_ as Layer.Layer<R, E>
    : Layer.provideMerge(layer_, TestEnv)
  const memoMap = options?.memoMap ?? Effect.runSync(Layer.makeMemoMap)
  const scope = Effect.runSync(Scope.make())
  const contextEffect = Layer.buildWithMemoMap(withTestEnv, memoMap, scope).pipe(
    Effect.orDie,
    Effect.cached,
    Effect.runSync
  )
  let closePromise: Promise<void> | undefined
  const closeScope = (): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise
    }
    closePromise = runPromise(Scope.close(scope, Exit.void)).then(() => {})
    return closePromise
  }

  const makeIt = (it: TestAPI): Rstest.Rstest.MethodsNonLive<R> =>
    makeItProxy(it, {
      effect: makeTester<R | Scope.Scope>(
        (effect) =>
          Effect.flatMap(contextEffect, (context) =>
            effect.pipe(
              Effect.scoped,
              Effect.provide(context)
            )),
        it
      ),
      prop: makeProp(it),
      flakyTest,
      layer<R2, E2>(nestedLayer: Layer.Layer<R2, E2, R>, options?: {
        readonly concurrent?: boolean
        readonly timeout?: Duration.Input
      }) {
        return layer(
          Layer.provideMerge(nestedLayer, withTestEnv),
          {
            ...options,
            memoMap: Layer.forkMemoMapUnsafe(memoMap),
            excludeTestServices
          },
          it
        )
      }
    })

  if (args.length === 1) {
    const timeout = hookTimeout(options?.timeout)
    return R.describe("", () => {
      R.beforeAll(() => runPromise(Effect.asVoid(contextEffect)), timeout)
      R.afterAll(() => closeScope(), timeout)
      return args[0](makeIt(testApi))
    })
  }

  const describe = options?.concurrent === true
    ? R.describe.concurrent
    : options?.concurrent === false
    ? R.describe.sequential
    : R.describe
  return describe(args[0], () => {
    R.beforeAll(
      () => runPromise(Effect.asVoid(contextEffect)),
      hookTimeout(options?.timeout)
    )
    R.afterAll(
      () => closeScope(),
      hookTimeout(options?.timeout)
    )
    return args[1](makeIt(testApi))
  })
}

const makeLayer = (it: TestAPI): Rstest.Rstest.Methods["layer"] => (layer_, options) => layer(layer_, options, it)

/** @internal */
export const flakyTest = <A, E, R>(
  self: Effect.Effect<A, E, R | Scope.Scope>,
  timeout: Duration.Input = Duration.seconds(30)
) =>
  pipe(
    self,
    Effect.scoped,
    Effect.sandbox,
    Effect.retry(
      pipe(
        Schedule.recurs(10),
        Schedule.while((_) =>
          Effect.succeed(Duration.isLessThanOrEqualTo(
            Duration.fromInputUnsafe(_.elapsed),
            Duration.fromInputUnsafe(timeout)
          ))
        )
      )
    ),
    Effect.orDie
  )

/** @internal */
export const makeMethods = (it: TestAPI): Rstest.Rstest.Methods =>
  makeItProxy(it, {
    effect: makeTester<Scope.Scope>(flow(Effect.scoped, Effect.provide(TestEnv)), it),
    live: makeTester<Scope.Scope>(Effect.scoped, it),
    flakyTest,
    layer: makeLayer(it),
    prop: makeProp(it)
  })

/** @internal */
export const {
  /** @internal */
  effect,
  /** @internal */
  live
} = makeMethods(R.it)

/** @internal */
export const describeWrapped = (name: string, f: (it: Rstest.Rstest.Methods) => void): void =>
  R.describe(name, () => f(makeMethods(R.it)))
