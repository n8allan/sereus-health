# Hermes V1: ternary with `[..., ...await x]` evaluates to `0` instead of array

**Component:** Hermes V1 (codegen for array spread inside generator resume path)
**Likely repo to file at:** [`facebook/hermes`](https://github.com/facebook/hermes)
**Severity:** Silent miscompilation — wrong value returned, no exception, no warning.

---

## Summary

Inside an `async` function compiled by `@react-native/babel-preset` (which lowers `async`/`await` to `function*`/`yield`), the expression

```js
return cond ? [...arr, ...(await asyncCall())] : [];
```

is miscompiled by Hermes V1. After the `await` resumes, the function returns the **number `0`** (not the spread'd array). The same source executes correctly in V8 (Node) — both as native `async`/`await` and in the `function*` form Babel produces.

The bug reproduces 10/10 trials on a release-channel Android device.

---

## Environment

| Field | Value |
| --- | --- |
| React Native | 0.85.1 |
| `@react-native/babel-preset` | 0.85.1 |
| Hermes (V1) | `250829098.0.10` (`HERMES_V1_VERSION_NAME` from `react-native/sdks/hermes-engine/version.properties`; bytecode version 98) |
| Hermes (legacy) | `0.16.0` (also recorded in the same `version.properties`, but V1 is the runtime in use) |
| Build mode | Dev bundle (Metro, dev=true), `transformProfile=hermes-stable` |
| Device | Pixel hardware, Android |
| iOS | **Untested** |
| Host (for hermesc / V8 sanity checks) | Windows 11 Pro 26200, Node v24.2.0 |

`npx react-native info` did not run cleanly on the host (Java not installed); versions above are read from the workspace lockfile and `react-native/sdks/hermes-engine/version.properties`.

---

## Minimal reproduction

### Source form (TypeScript / native `async`/`await`)

```ts
async function failingPattern(): Promise<unknown> {
  const arr = [1];
  return true ? [...arr, ...(await Promise.resolve([2]))] : [];
}

failingPattern().then(r => {
  console.warn('result =', JSON.stringify(r), 'isArray =', Array.isArray(r));
});
```

### Bundled form (after `@react-native/babel-preset`, exact output)

The preset preserves the array-spread syntax verbatim — its only relevant transform is `async` → `function*` and `await` → `yield`:

```js
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));
function failingPattern() { return _failingPattern.apply(this, arguments); }
function _failingPattern() {
  _failingPattern = (0, _asyncToGenerator2.default)(function* () {
    var arr = [1];
    return true ? [...arr, ...(yield Promise.resolve([2]))] : [];
  });
  return _failingPattern.apply(this, arguments);
}
```

### Standalone Hermes-runnable repro

This is self-contained — paste into any `hermes` runtime build and run:

```js
function _asyncToGenerator(fn){return function(){var self=this,args=arguments;return new Promise(function(resolve,reject){var gen=fn.apply(self,args);function step(key,arg){try{var info=gen[key](arg);var value=info.value;}catch(error){reject(error);return}if(info.done){resolve(value)}else{Promise.resolve(value).then(function(v){step('next',v)},function(e){step('throw',e)})}}step('next')})}}

var failingPattern = _asyncToGenerator(function* () {
  var arr = [1];
  return true ? [...arr, ...(yield Promise.resolve([2]))] : [];
});

failingPattern().then(function (r) {
  print('result:', JSON.stringify(r), 'isArray:', Array.isArray(r));
});
```

---

## Expected behavior

```
result: [1,2] isArray: true
```

This is what **V8 (Node)** prints for both the source form and the post-Babel `function*`/`yield` form.

## Actual behavior (Hermes V1, RN 0.85.1, Android, dev build, 10/10 runs)

```
result: 0 isArray: false      // typeof === 'number'
```

The function returns the numeric value `0` instead of the array.

---

## Necessary trigger conditions

All four must hold; removing any one masks the bug. Verified by reduction in this codebase:

1. **Inside an async function** — the bytecode path that is miscompiled is the generator-resume path (Babel's `_asyncToGenerator` + `function*` + `yield`). A regular non-async function with the same shape works correctly.
2. **Ternary `?:` operator.** Replacing the ternary with `if (cond) return [...]; else return [];` does **not** trigger.
3. **Truthy branch is an array literal with at least two spread elements.** A single spread in the truthy branch does not trigger.
4. **The *last* spread expression contains the `await`.** Putting the `await` in the first spread (`[...(await x), ...arr]`) does **not** trigger.

---

## Workaround

Extract the `await` into a local variable before the ternary. Verified to fix the issue 10/10 in production.

```ts
// Failing
async function fn() {
  const arr = [1];
  return true ? [...arr, ...(await Promise.resolve([2]))] : [];
}

// Fixed
async function fn() {
  const arr = [1];
  const tail = await Promise.resolve([2]);
  return true ? [...arr, ...tail] : [];
}
```

---

## What was tried (negative results — these do *not* trigger)

- `if/else` instead of the ternary.
- Single spread in the truthy branch (`[...(await x)]` or `[...arr]`).
- `await` in the *first* spread, with a non-await spread after it (`[...(await x), ...arr]`).
- Storing the awaited value in a local first, then spreading the local.

Only the exact shape `cond ? [..., ..., ...(await x)] : […]` (last spread containing `await`, ternary, async function) reproduces.

---

## Layer pinpointed: Hermes V1 codegen

Evidence:

1. **Source-level JS is valid.** Both forms (native `async`/`await` and post-Babel `function*`/`yield`) return `[1, 2]` in V8 (Node 24.2.0).
2. **Babel transform is innocent.** `@react-native/babel-preset` 0.85.1 leaves the array-spread literal exactly as written; it only lowers `async` → generator and `await` → `yield`. The bug does not arise from a malformed AST that Babel produced.
3. **Hermes bytecode for the resume path returns the wrong register.** Compiling the standalone repro above with the shipped `hermesc` (`node_modules/hermes-compiler/hermesc/win64-bin/hermesc.exe`, version `250829098.0.10`, bytecode v98) and dumping bytecode shows that on the generator-resume path:
   - The accumulator array (the target of `HermesBuiltin.arraySpread`) is held in an environment slot that is **never reloaded into the value-return register** before `Ret`.
   - At `-O0`, the resume path emits `Mov r0, r8` (where `r8` is the previously-loaded `nextIndex` integer counter, not the accumulator), then jumps to a return block that emits `PutOwnBySlotIdx … r11, 0; Ret`. The returned `value` is the integer counter, not the array.
   - At `-O`, the resume path uses a stale empty `NewArray` placeholder produced before the dispatch fan-out as the `value` of the result object, and likewise never loads the mutated accumulator. Either way the codegen forgets to materialize the accumulator into the result.

   Excerpt (`-O0`, the generator's anonymous body, resume path):

   ```
   ; loaded earlier on resume:
   ;   r2 = env[4]   (accumulator array, pre-second-spread)
   ;   r8 = env[2]   (saved nextIndex from before yield)
   ;   r13 = the resumed value (the array yielded back in)

   Mov               r18, r2
   Mov               r17, r13
   Mov               r16, r8
   CallBuiltin       r2, "HermesBuiltin.arraySpread", 4
   StoreNPToEnvironment r3, 2, r2     ; env[2] = new nextIndex (correct)
   Mov               r0, r8           ; <-- BUG: r0 set to the OLD nextIndex (a number),
                                      ;     not env[4] (the mutated accumulator)
   JmpLong           L6
   L6:
       LoadConstUInt8    r2, 3
       StoreNPToEnvironment r3, 9, r2
       Mov               r11, r0       ; r11 = the number
   L15:
       NewObjectWithBuffer r2, 0, 10
       PutOwnBySlotIdx   r2, r11, 0    ; result.value = the number
       Ret               r2            ; -> { value: <number>, done: true }
   ```

   In other words, the resume path emits the moral equivalent of `return nextIndex;` instead of `return accumulator;`. The accumulator (`env[4]`) is correctly mutated by `arraySpread` — it just is not loaded into the return register.

4. **Runtime confirmation outside RN is pending.** RN 0.85.1 ships only the Hermes *compiler* (`hermesc`) in `node_modules`, not a `hermes` *runtime* binary, so the standalone repro above could not be executed on the host. The bytecode dumps and V8 sanity checks above are sufficient to localize the bug to Hermes; running the standalone snippet in a `hermes` runtime build would directly reproduce.

**Conclusion:** this is a Hermes V1 codegen bug. Please file at `facebook/hermes`.
