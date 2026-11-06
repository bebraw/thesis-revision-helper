# ADR-071: Accept Local Path-Replacement Race

**Status:** Implemented

**Date:** 2026-11-06

## Context

The local project service checks paths for traversal and symbolic links before opening or replacing files. These checks are not anchored to directory file descriptors. A local actor able to replace a checked project directory during the operation can substitute a symbolic link between validation and access and potentially redirect access outside the project.

The application targets a single user and the user has accepted this specific limitation. The observed behavior and current controls are described in the [product spec](../../../specs/thesis-revision/spec.md).

## Decision

Accept the concurrent ancestor-directory replacement race in the current local project service. Do not claim that path access is race-free when another local actor can change project directories during an operation.

Continue rejecting ordinary path traversal, visible symbolic links, and multiply linked files. Continue treating manuscript content and model output as untrusted and preserve the loopback, origin, and request-validation boundaries. This decision does not authorize arbitrary paths or relax those protections.

## Consequences

**Positive:**

- The local single-user workflow can use the existing lightweight project service without a native filesystem helper.

**Negative:**

- A local actor with the ability to replace project directories during access may redirect reads or writes outside the selected project.
- The current checks do not provide a race-free containment guarantee against that actor.

**Neutral:**

- Revisit the decision if the application is deployed in an environment where project directories can be modified by untrusted actors concurrently.

## Alternatives Considered

### Descriptor-Anchored Native Access

A native helper using directory-relative operations could provide a stronger basis for path confinement, but requires a new native integration and careful validation. It is not required for the accepted current scope.

### Additional Path Checks

Repeating pathname or realpath checks may narrow the timing window but cannot eliminate replacement between a check and filesystem access. It would not justify claiming race-free confinement.
