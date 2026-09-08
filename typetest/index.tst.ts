import { Context, Effect, Layer, Schema } from "effect"
import { it, layer } from "effect-rstest"
import { FastCheck } from "effect/testing"
import { describe, expect, test } from "tstyche"

class Foo extends Context.Service<Foo, "foo">()("Foo") {}
class Bar extends Context.Service<Bar, "bar">()("Bar") {}

describe("layer", () => {
  test("top-level export accepts full options", () => {
    expect(layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"), {
      concurrent: false,
      timeout: "5 seconds",
      excludeTestServices: true,
      memoMap: undefined as any
    })
  })

  test("top-level export accepts no options", () => {
    expect(layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"))
  })

  test("it.layer accepts full options", () => {
    expect(it.layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"), {
      concurrent: false,
      timeout: "5 seconds",
      excludeTestServices: true,
      memoMap: undefined as any
    })
  })

  test("it.layer accepts no options", () => {
    expect(it.layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"))
  })

  test("nested it.layer accepts concurrency and timeout", () => {
    layer(Layer.succeed(Foo, "foo"))((it) => {
      expect(it.layer).type.toBeCallableWith(Layer.succeed(Bar, "bar"), {
        concurrent: true,
        timeout: "3 seconds"
      })
    })
  })

  test("concurrency does not require other options", () => {
    expect(layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"), { concurrent: true })
    expect(it.layer).type.toBeCallableWith(Layer.succeed(Foo, "foo"), { concurrent: true })
    layer(Layer.succeed(Foo, "foo"))((it) => {
      expect(it.layer).type.toBeCallableWith(Layer.succeed(Bar, "bar"), { concurrent: false })
    })
  })

  test("concurrency must be boolean", () => {
    expect(layer).type.not.toBeCallableWith(Layer.succeed(Foo, "foo"), { concurrent: "false" })
    expect(it.layer).type.not.toBeCallableWith(Layer.succeed(Foo, "foo"), { concurrent: "false" })
    layer(Layer.succeed(Foo, "foo"))((it) => {
      expect(it.layer).type.not.toBeCallableWith(Layer.succeed(Bar, "bar"), { concurrent: "false" })
    })
  })

  test("nested it.layer rejects excludeTestServices", () => {
    layer(Layer.succeed(Foo, "foo"))((it) => {
      expect(it.layer).type.not.toBeCallableWith(Layer.succeed(Bar, "bar"), {
        excludeTestServices: true
      })
    })
  })

  test("nested it.layer rejects memoMap", () => {
    layer(Layer.succeed(Foo, "foo"))((it) => {
      expect(it.layer).type.not.toBeCallableWith(Layer.succeed(Bar, "bar"), {
        memoMap: undefined as any
      })
    })
  })
})

describe("property testing", () => {
  test("rejects asynchronous pure properties", () => {
    expect(it.prop).type.not.toBeCallableWith(
      "async property",
      [Schema.Int],
      async ([value]: [number]) => value === value
    )
  })

  test("infers Schema tuple values and accepts Arbitrary options", () => {
    it.effect.prop(
      "schema tuple",
      [Schema.String, Schema.Int],
      ([text, count]) => {
        expect(text).type.toBe<string>()
        expect(count).type.toBe<number>()
        return Effect.void
      },
      { fastCheck: { numRuns: 10, seed: 1001 } }
    )
  })

  test("accepts readonly Schema tuples", () => {
    const inputs = [Schema.String, Schema.Int] as const

    it.prop("readonly tuple", inputs, ([text, count]) => {
      expect(text).type.toBe<string>()
      expect(count).type.toBe<number>()
    })
  })

  test("infers Schema record values for the pure property helper", () => {
    it.prop(
      "schema record",
      { text: Schema.String, count: Schema.Int },
      ({ text, count }) => {
        expect(text).type.toBe<string>()
        expect(count).type.toBe<number>()
      },
      { fastCheck: { numRuns: 10 } }
    )
  })

  test("infers mixed Schema and Arbitrary values", () => {
    const text = FastCheck.constantFrom("a" as const, "b" as const)

    it.effect.prop(
      "mixed tuple",
      [Schema.Int, text],
      ([count, value]) => {
        expect(count).type.toBe<number>()
        expect(value).type.toBe<"a" | "b">()
        return Effect.void
      }
    )

    it.prop(
      "mixed record",
      { count: Schema.Int, text },
      ({ count, text }) => {
        expect(count).type.toBe<number>()
        expect(text).type.toBe<"a" | "b">()
      }
    )
  })
})

describe("case tables", () => {
  test("passes one case to each Effect callback", () => {
    const each = it.effect.each([1, 2])

    expect(each).type.toBeCallableWith("case", (value: number) => Effect.succeed(value))
    expect(each).type.not.toBeCallableWith("case", (value: number, extra: number) => Effect.succeed(value + extra))
  })
})
