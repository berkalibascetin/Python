import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MockStep } from "@mission-control/gateway";

/**
 * Golden set kaydı (MASTER_PLAN §16 "agent behavior eval").
 *
 * Her senaryo bir kusur SINIFINI temsil eder ve iki şey taşır:
 *  - gerçek proje dosyaları (fixtures/golden/<name>)
 *  - mock sürücü için bir çözüm betiği
 *
 * Mock betikleri gerçek bir modelin izleyeceği makul yolu taklit eder
 * (oku → düzelt → test et). Amaçları modelin yerini almak DEĞİL, harness'ın
 * ve agent döngüsünün gerçek projeler üzerinde doğru çalıştığını gösterebilmek.
 * Model yeteneğinin ölçüsü yalnızca canlı sürücüyle koşulduğunda oluşur.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/golden");

/** Senaryonun neyi kanıtlaması gerektiği. */
export type ScenarioExpectation =
  | "fix" // kusur var: düzeltilmeli ve testler yeşile dönmeli
  | "already-green" // kusur yok: bozmadan bırakmalı
  | "unverifiable"; // test seti yok: başarı İDDİA EDİLMEMELİ

export interface GoldenScenario {
  name: string;
  /** Kusur sınıfı — rapor okunurken hangi yeteneğin sınandığını gösterir. */
  defectClass: string;
  dir: string;
  goal: string;
  expect: ScenarioExpectation;
  mockScript: MockStep[];
}

type ToolCallSpec = NonNullable<MockStep["toolCalls"]>;

const read = (path: string): ToolCallSpec => [{ name: "repo.read", input: { path } }];
const edit = (path: string, oldString: string, newString: string): ToolCallSpec => [
  { name: "repo.write", input: { path, old_string: oldString, new_string: newString } },
];
const runPytest: ToolCallSpec = [
  { name: "shell.run", input: { command: "python3", args: ["-m", "pytest", "-q"] } },
];

export const GOLDEN_SET: GoldenScenario[] = [
  {
    name: "py-auth-bug",
    defectClass: "missing-key guard",
    dir: join(FIXTURES, "py-auth-bug"),
    goal: "The authentication tests are failing. Find the bug and fix it.",
    expect: "fix",
    mockScript: [
      { text: "Let me look at the failing module.", toolCalls: read("auth_service.py") },
      {
        text: "Unknown usernames hit a KeyError; I'll look them up safely.",
        toolCalls: edit(
          "auth_service.py",
          "    user = USERS[username]",
          "    user = USERS.get(username)\n    if user is None:\n        return None",
        ),
      },
      {
        text: "require_role also indexes a possibly-None user; guarding that too.",
        toolCalls: edit(
          "auth_service.py",
          '    user = authenticate(username, password)\n    return user["role"] == role',
          '    user = authenticate(username, password)\n    if user is None:\n        return False\n    return user["role"] == role',
        ),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "authenticate() raised KeyError for unknown users; it now returns None." },
    ],
  },
  {
    name: "py-off-by-one",
    defectClass: "boundary arithmetic",
    dir: join(FIXTURES, "py-off-by-one"),
    goal: "last_n() returns the wrong number of items. Fix it.",
    expect: "fix",
    mockScript: [
      { text: "Reading the slicing helpers.", toolCalls: read("slicing.py") },
      {
        text: "The slice start is one item too late.",
        toolCalls: edit(
          "slicing.py",
          "    return items[len(items) - n + 1 :]",
          "    return items[len(items) - n :]",
        ),
      },
      { text: "Checking the tests.", toolCalls: runPytest },
      { text: "The slice started one index too far in; removed the extra +1." },
    ],
  },
  {
    name: "py-wrong-operator",
    defectClass: "inverted comparison",
    dir: join(FIXTURES, "py-wrong-operator"),
    goal: "Someone who is exactly 18 is treated as a minor. Fix the eligibility check.",
    expect: "fix",
    mockScript: [
      { text: "Looking at the eligibility rules.", toolCalls: read("eligibility.py") },
      {
        text: "The boundary age itself must count as an adult.",
        toolCalls: edit("eligibility.py", "return age > MINIMUM_AGE", "return age >= MINIMUM_AGE"),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "The comparison excluded the boundary age; it is now inclusive." },
    ],
  },
  {
    name: "py-missing-return",
    defectClass: "silent None return",
    dir: join(FIXTURES, "py-missing-return"),
    goal: "normalize() returns None instead of the normalized name. Fix it.",
    expect: "fix",
    mockScript: [
      { text: "Reading the text helpers.", toolCalls: read("text_utils.py") },
      {
        text: "The normalized value is computed but never returned.",
        toolCalls: edit(
          "text_utils.py",
          "    name.strip().lower()",
          "    return name.strip().lower()",
        ),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "The function dropped its result on the floor; added the missing return." },
    ],
  },
  {
    name: "py-multi-file",
    defectClass: "defect in a different file than the failing test",
    dir: join(FIXTURES, "py-multi-file"),
    goal: "Cart totals lose their cents. Fix the formatting.",
    expect: "fix",
    mockScript: [
      { text: "Starting from the failing test's module.", toolCalls: read("cart.py") },
      { text: "cart.py only delegates; the formatting lives elsewhere.", toolCalls: read("formatter.py") },
      {
        text: "Float division drops trailing zeros; formatting to two decimals.",
        toolCalls: edit("formatter.py", 'return f"${cents / 100}"', 'return f"${cents / 100:.2f}"'),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "format_price() relied on float repr; it now formats to two decimals." },
    ],
  },
  {
    name: "py-exception-swallowed",
    defectClass: "swallowed exception",
    dir: join(FIXTURES, "py-exception-swallowed"),
    goal: "Invalid configuration is silently ignored instead of reported. Fix it.",
    expect: "fix",
    mockScript: [
      { text: "Reading the config loader.", toolCalls: read("config_loader.py") },
      {
        text: "The bare except hides real parse errors from the caller.",
        toolCalls: edit(
          "config_loader.py",
          "    try:\n        return json.loads(text)\n    except Exception:\n        pass",
          "    return json.loads(text)",
        ),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "parse_config() swallowed every error and returned None; it now propagates." },
    ],
  },
  {
    name: "py-mutable-default",
    defectClass: "shared mutable default",
    dir: join(FIXTURES, "py-mutable-default"),
    goal: "Baskets are sharing items between unrelated calls. Fix it.",
    expect: "fix",
    mockScript: [
      { text: "Reading the basket helpers.", toolCalls: read("basket.py") },
      {
        text: "The default list is created once and shared across calls.",
        toolCalls: edit(
          "basket.py",
          'def add_item(item, basket=[]):\n    """Add an item to a basket, returning the basket."""',
          'def add_item(item, basket=None):\n    """Add an item to a basket, returning the basket."""\n    if basket is None:\n        basket = []',
        ),
      },
      { text: "Running the tests.", toolCalls: runPytest },
      { text: "The default argument was a single shared list; each call now gets its own." },
    ],
  },
  {
    name: "py-already-green",
    defectClass: "no defect (negative control)",
    dir: join(FIXTURES, "py-already-green"),
    goal: "Check the inventory module and fix anything that is broken.",
    expect: "already-green",
    mockScript: [
      { text: "Checking the current state first.", toolCalls: runPytest },
      { text: "Reading the module to be sure.", toolCalls: read("inventory.py") },
      { text: "All four tests pass and the code matches its documented behavior; nothing to change." },
    ],
  },
  {
    name: "js-sum-bug",
    defectClass: "wrong reduce seed (non-Python verification path)",
    dir: join(FIXTURES, "js-sum-bug"),
    goal: "The stats tests are failing. Find the bug and fix it.",
    expect: "fix",
    mockScript: [
      { text: "Reading the stats module.", toolCalls: read("stats.js") },
      {
        text: "reduce() starts from 1, so every sum is off by one.",
        toolCalls: edit(
          "stats.js",
          "return numbers.reduce((total, n) => total + n, 1);",
          "return numbers.reduce((total, n) => total + n, 0);",
        ),
      },
      {
        text: "Running the tests.",
        toolCalls: [{ name: "shell.run", input: { command: "npm", args: ["test", "--silent"] } }],
      },
      { text: "The reduce seed was 1 instead of 0, inflating every total." },
    ],
  },
  {
    name: "no-tests",
    defectClass: "unverifiable project",
    dir: join(FIXTURES, "no-tests"),
    goal: "Review the report module and fix anything that is broken.",
    expect: "unverifiable",
    mockScript: [
      { text: "Reading the module.", toolCalls: read("report.py") },
      { text: "The logic looks correct, but there is no test suite here to confirm it." },
    ],
  },
];
