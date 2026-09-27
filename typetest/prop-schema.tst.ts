import { it } from "effect-rstest"
import { Effect, Schema } from "effect"
import { Arbitrary } from "effect/unstable/arbitrary"
import { describe, expect, test } from "tstyche"

describe("schema properties", () => {
  test("plain tuple inputs infer schema and arbitrary values", () => {
    it.prop("tuple", [Schema.Literal("schema"), Arbitrary.schema(Schema.Int)], ([label, count]) => {
      expect(label).type.toBe<"schema">()
      expect(count).type.toBe<number>()
    })
  })

  test("plain record inputs infer schema and arbitrary values", () => {
    it.prop("record", { label: Schema.Literal("schema"), count: Arbitrary.schema(Schema.Int) }, ({ label, count }) => {
      expect(label).type.toBe<"schema">()
      expect(count).type.toBe<number>()
    })
  })

  test("effect tests accept non-void success values", () => {
    expect(it.effect).type.toBeCallableWith("non-void", () => Effect.succeed(false))
    expect(it.live).type.toBeCallableWith("non-void", () => Effect.succeed(42))
  })
})
