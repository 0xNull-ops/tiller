import { createWorkflowTemplateCommands } from "./workflowTemplates.ts";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthCredentialsManageScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  WS_METHODS,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "./commandPermissions.ts";

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("target");
const other = EnvironmentId.make("other");
const grant = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: allowed ? [AuthOrchestrationOperateScope] : [],
  permissions: allowed ? [AuthOrchestrationOperateScope] : [],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);
const setup = Effect.gen(function* () {
  const registry = AtomRegistry.make();
  registry.mount(sessions(env));
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return registry;
});

describe("command permissions", () => {
  it.effect("workflow controls require the destination operate grant", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        for (const method of [
          WS_METHODS.workflowsStop,
          WS_METHODS.workflowsApprove,
          WS_METHODS.workflowsResume,
          WS_METHODS.workflowsEdit,
        ]) {
          const control = createCommandPermissions(runtime, method);
          registry.set(sessions(env), AsyncResult.success(grant(true)));
          registry.set(sessions(other), AsyncResult.success(grant(false)));
          expect(registry.get(control.permissionAtom(env))).toBe(true);
          yield* control.authorize(registry, env);
          expect(registry.get(control.permissionAtom(other))).toBe(false);
          expect((yield* control.authorize(registry, other).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
          registry.set(sessions(env), AsyncResult.success(grant(false)));
          expect((yield* control.authorize(registry, env).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
        }
      }),
    ),
  );

  it.effect(
    "credential management accepts explicit or terminal access on the destination environment",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* setup;
          for (const method of [
            WS_METHODS.credentialsList,
            WS_METHODS.credentialsCreate,
            WS_METHODS.credentialsSetSecret,
            WS_METHODS.credentialsDelete,
          ]) {
            const command = createCommandPermissions(runtime, method);
            registry.set(sessions(env), AsyncResult.success(grant(false)));
            expect(registry.get(command.permissionAtom(env))).toBe(false);
            expect(
              (yield* command.authorize(registry, env).pipe(Effect.flip)).requiredPermission,
            ).toBe(AuthCredentialsManageScope);
            registry.set(
              sessions(env),
              AsyncResult.success({
                ...grant(false),
                scopes: [AuthCredentialsManageScope],
                permissions: [AuthCredentialsManageScope],
              }),
            );
            expect(registry.get(command.permissionAtom(env))).toBe(true);
            yield* command.authorize(registry, env);
            for (const authenticated of [true, false]) {
              registry.set(
                sessions(env),
                AsyncResult.success({
                  ...grant(false),
                  authenticated,
                  scopes: ["terminal:operate"],
                  permissions: ["terminal:operate"],
                }),
              );
              expect(registry.get(command.permissionAtom(env))).toBe(authenticated);
              if (authenticated) yield* command.authorize(registry, env);
              else
                expect(
                  (yield* command.authorize(registry, env).pipe(Effect.flip)).requiredPermission,
                ).toBe(AuthCredentialsManageScope);
            }
            registry.set(sessions(other), AsyncResult.success(grant(true)));
            expect(registry.get(command.permissionAtom(other))).toBe(false);
          }
        }),
      ),
  );

  it.effect("template commands authorize against the destination environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        const templates = createWorkflowTemplateCommands(runtime);
        for (const [command, tag, scope] of [
          [templates.use, WS_METHODS.workflowTemplateUse, AuthSettingsWriteScope],
          [templates.list, WS_METHODS.workflowTemplatesList, AuthOrchestrationReadScope],
        ] as const) {
          const permissions = createCommandPermissions(runtime, tag);
          registry.set(
            sessions(env),
            AsyncResult.success({ ...grant(false), scopes: [scope], permissions: [scope] }),
          );
          expect(registry.get(command.permissionAtom(env))).toBe(true);
          yield* permissions.authorize(registry, env);
          expect(registry.get(command.permissionAtom(other))).toBe(false);
          registry.set(sessions(env), AsyncResult.success(grant(false)));
          expect(
            (yield* permissions.authorize(registry, env).pipe(Effect.flip)).requiredPermission,
          ).toBe(scope);
        }
      }),
    ),
  );
});
