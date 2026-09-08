import { describe, it, expect } from "vitest";
import {
  StateMachineService,
  STAGE_TRANSITIONS,
  STAGE_OBJECTIVES,
} from "../../packages/flow/src/state-machine.js";
import {
  ConversationStage,
  CANONICAL_CONVERSATION_STAGES,
  LEGACY_STAGE_MAP,
  normalizeConversationStage,
} from "../../packages/shared/src/enums.js";

describe("Adversarial Stress Harness: StateMachineService & ConversationStage", () => {
  const ALL_8_STATES: ConversationStage[] = [
    ConversationStage.NEW_CONVERSATION,
    ConversationStage.QUALIFYING,
    ConversationStage.COLLECTING_INFORMATION,
    ConversationStage.PRESENTING_SOLUTION,
    ConversationStage.NEGOTIATING,
    ConversationStage.CONVERTED,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ];

  // =========================================================================
  // 1. Exact 8 Canonical States Structure
  // =========================================================================
  describe("Canonical State Invariants", () => {
    it("should have exactly 8 unique canonical states", () => {
      expect(CANONICAL_CONVERSATION_STAGES).toHaveLength(8);
      const uniqueStages = new Set(CANONICAL_CONVERSATION_STAGES);
      expect(uniqueStages.size).toBe(8);
    });

    it("getCanonicalStages() returns a fresh copy of 8 stages", () => {
      const copy1 = StateMachineService.getCanonicalStages();
      const copy2 = StateMachineService.getCanonicalStages();
      expect(copy1).toHaveLength(8);
      expect(copy1).toEqual(CANONICAL_CONVERSATION_STAGES);
      expect(copy1).not.toBe(copy2); // fresh copy, not mutated reference
    });
  });

  // =========================================================================
  // 2. Comprehensive 8x8 Pairwise Transition Matrix (64 Combinations)
  // =========================================================================
  describe("Pairwise Transition Matrix (8x8 = 64 pairs)", () => {
    // Ground truth oracle based on R4 & transition DAG:
    // State -> Allowed non-self targets
    const ALLOWED_TARGETS: Record<ConversationStage, ConversationStage[]> = {
      [ConversationStage.NEW_CONVERSATION]: [
        ConversationStage.QUALIFYING,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.QUALIFYING]: [
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.COLLECTING_INFORMATION]: [
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.PRESENTING_SOLUTION]: [
        ConversationStage.NEGOTIATING,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.NEGOTIATING]: [
        ConversationStage.CONVERTED,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.CONVERTED]: [], // Terminal: 0 transitions
      [ConversationStage.HUMAN_HANDOFF]: [
        ConversationStage.QUALIFYING,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
        ConversationStage.CLOSED,
      ],
      [ConversationStage.CLOSED]: [], // Terminal: 0 transitions
    };

    it("evaluates all 64 state pairs strictly against the transition oracle", () => {
      let allowedCount = 0;
      let rejectedCount = 0;

      for (const fromState of ALL_8_STATES) {
        for (const toState of ALL_8_STATES) {
          const actualValid = StateMachineService.validateTransition(fromState, toState);
          const isSelf = fromState === toState;
          const isAllowedNonSelf = ALLOWED_TARGETS[fromState].includes(toState);
          const expectedValid = isSelf || isAllowedNonSelf;

          expect(
            actualValid,
            `Transition ${fromState} -> ${toState} expected ${expectedValid} but got ${actualValid}`
          ).toBe(expectedValid);

          if (actualValid) {
            allowedCount++;
          } else {
            rejectedCount++;
          }
        }
      }

      // Verify total allowed count = 8 self-transitions + 19 non-self allowed transitions = 27
      expect(allowedCount).toBe(27);
      expect(rejectedCount).toBe(37);
      expect(allowedCount + rejectedCount).toBe(64);
    });
  });

  // =========================================================================
  // 3. Terminal State Immutability
  // =========================================================================
  describe("Terminal State Immutability (CONVERTED and CLOSED)", () => {
    const terminalStates = [ConversationStage.CONVERTED, ConversationStage.CLOSED];

    for (const term of terminalStates) {
      it(`enforces ${term} rejects transition to every other non-self state`, () => {
        const otherStates = ALL_8_STATES.filter((s) => s !== term);
        expect(otherStates).toHaveLength(7);

        for (const other of otherStates) {
          const result = StateMachineService.validateTransition(term, other);
          expect(result, `Terminal state ${term} must reject transition to ${other}`).toBe(false);
        }
      });

      it(`enforces ${term} has empty allowed transitions list`, () => {
        expect(StateMachineService.getAllowedTransitions(term)).toEqual([]);
        expect(STAGE_TRANSITIONS[term]).toEqual([]);
      });

      it(`correctly identifies ${term} as terminal`, () => {
        expect(StateMachineService.isTerminalState(term)).toBe(true);
        expect(StateMachineService.isTerminalStage(term)).toBe(true);
      });
    }

    it("verifies all other 6 non-terminal states are not reported as terminal", () => {
      const nonTerminal = ALL_8_STATES.filter(
        (s) => s !== ConversationStage.CONVERTED && s !== ConversationStage.CLOSED
      );
      expect(nonTerminal).toHaveLength(6);
      for (const st of nonTerminal) {
        expect(StateMachineService.isTerminalState(st)).toBe(false);
        expect(StateMachineService.isTerminalStage(st)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 4. Self-Transitions (Idempotency)
  // =========================================================================
  describe("Self-Transitions (Idempotency)", () => {
    it("allows self-transitions for all 8 states unconditionally", () => {
      for (const st of ALL_8_STATES) {
        expect(
          StateMachineService.validateTransition(st, st),
          `Self-transition for ${st} should be true (idempotent)`
        ).toBe(true);
      }
    });
  });

  // =========================================================================
  // 5. getNextRecommendedStage Across All States
  // =========================================================================
  describe("getNextRecommendedStage Behavior", () => {
    it("recommends the exact next linear funnel stage", () => {
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.NEW_CONVERSATION))
        .toBe(ConversationStage.QUALIFYING);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.QUALIFYING))
        .toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.COLLECTING_INFORMATION))
        .toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.PRESENTING_SOLUTION))
        .toBe(ConversationStage.NEGOTIATING);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.NEGOTIATING))
        .toBe(ConversationStage.CONVERTED);
    });

    it("retains terminal and handoff stages on recommendation", () => {
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.CONVERTED))
        .toBe(ConversationStage.CONVERTED);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.HUMAN_HANDOFF))
        .toBe(ConversationStage.HUMAN_HANDOFF);
      expect(StateMachineService.getNextRecommendedStage(ConversationStage.CLOSED))
        .toBe(ConversationStage.CLOSED);
    });

    it("nextSuggestedStage alias produces identical results to getNextRecommendedStage", () => {
      for (const st of ALL_8_STATES) {
        expect(StateMachineService.nextSuggestedStage(st))
          .toBe(StateMachineService.getNextRecommendedStage(st));
      }
    });
  });

  // =========================================================================
  // 6. Normalization Stress: Null, Undefined, Unknown Strings, Legacy Aliases
  // =========================================================================
  describe("Normalization: Nullish, Unknown, and Legacy Aliases", () => {
    it("defaults nullish and empty inputs to NEW_CONVERSATION", () => {
      expect(normalizeConversationStage(null)).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage(undefined)).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("   ")).toBe(ConversationStage.NEW_CONVERSATION);
    });

    it("defaults unrecognized / arbitrary strings to NEW_CONVERSATION", () => {
      expect(normalizeConversationStage("UNKNOWN_STAGE")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("FOOBAR_12345")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("!@#$%^&*()")).toBe(ConversationStage.NEW_CONVERSATION);
    });

    it("correctly maps uppercase legacy aliases to canonical states", () => {
      expect(normalizeConversationStage("NEW")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("CONTACT_STARTED")).toBe(ConversationStage.QUALIFYING);
      expect(normalizeConversationStage("DISCOVERY")).toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(normalizeConversationStage("QUALIFYING")).toBe(ConversationStage.QUALIFYING);
      expect(normalizeConversationStage("QUALIFIED")).toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(normalizeConversationStage("HANDOFF")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("HUMAN")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("CUSTOMER")).toBe(ConversationStage.CONVERTED);
      expect(normalizeConversationStage("LOST")).toBe(ConversationStage.CLOSED);
      expect(normalizeConversationStage("NO_RESPONSE")).toBe(ConversationStage.CLOSED);
      expect(normalizeConversationStage("NOT_QUALIFIED")).toBe(ConversationStage.CLOSED);
    });

    it("maps lowercase legacy aliases to canonical states", () => {
      expect(normalizeConversationStage("new")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("contact_started")).toBe(ConversationStage.QUALIFYING);
      expect(normalizeConversationStage("discovery")).toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(normalizeConversationStage("qualified")).toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(normalizeConversationStage("handoff")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("human")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("customer")).toBe(ConversationStage.CONVERTED);
      expect(normalizeConversationStage("lost")).toBe(ConversationStage.CLOSED);
      expect(normalizeConversationStage("no_response")).toBe(ConversationStage.CLOSED);
      expect(normalizeConversationStage("not_qualified")).toBe(ConversationStage.CLOSED);
    });
  });

  // =========================================================================
  // 7. Normalization Adversarial Stress: Mixed Casing of Canonical States
  // =========================================================================
  describe("Normalization Adversarial Stress: Case Sensitivity on Canonical States", () => {
    it("should normalize lowercase canonical strings correctly", () => {
      expect(normalizeConversationStage("new_conversation"))
        .toBe(ConversationStage.NEW_CONVERSATION);
      expect(normalizeConversationStage("qualifying"))
        .toBe(ConversationStage.QUALIFYING);
      expect(normalizeConversationStage("collecting_information"))
        .toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(normalizeConversationStage("presenting_solution"))
        .toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(normalizeConversationStage("negotiating"))
        .toBe(ConversationStage.NEGOTIATING);
      expect(normalizeConversationStage("converted"))
        .toBe(ConversationStage.CONVERTED);
      expect(normalizeConversationStage("human_handoff"))
        .toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("closed"))
        .toBe(ConversationStage.CLOSED);
    });

    it("should normalize mixed-case canonical strings correctly", () => {
      expect(normalizeConversationStage("Collecting_Information"))
        .toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(normalizeConversationStage("Presenting_Solution"))
        .toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(normalizeConversationStage("Negotiating"))
        .toBe(ConversationStage.NEGOTIATING);
      expect(normalizeConversationStage("Converted"))
        .toBe(ConversationStage.CONVERTED);
      expect(normalizeConversationStage("Human_Handoff"))
        .toBe(ConversationStage.HUMAN_HANDOFF);
      expect(normalizeConversationStage("Closed"))
        .toBe(ConversationStage.CLOSED);
    });

    it("should handle canonical names with leading/trailing whitespace and mixed case", () => {
      expect(normalizeConversationStage("  collecting_information  "))
        .toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(normalizeConversationStage("\tnegotiating\n"))
        .toBe(ConversationStage.NEGOTIATING);
      expect(normalizeConversationStage("  Converted  "))
        .toBe(ConversationStage.CONVERTED);
      expect(normalizeConversationStage("  closed  "))
        .toBe(ConversationStage.CLOSED);
    });
  });

  // =========================================================================
  // 8. Downstream Cascading Impact of Normalization
  // =========================================================================
  describe("Downstream Cascading Impact of Normalization on StateMachineService", () => {
    it("validateTransition with lowercase canonical stages", () => {
      // Valid transitions when input in lowercase:
      expect(
        StateMachineService.validateTransition("qualifying", "collecting_information"),
        "qualifying -> collecting_information should be valid"
      ).toBe(true);

      expect(
        StateMachineService.validateTransition("collecting_information", "presenting_solution"),
        "collecting_information -> presenting_solution should be valid"
      ).toBe(true);

      expect(
        StateMachineService.validateTransition("presenting_solution", "negotiating"),
        "presenting_solution -> negotiating should be valid"
      ).toBe(true);

      expect(
        StateMachineService.validateTransition("negotiating", "converted"),
        "negotiating -> converted should be valid"
      ).toBe(true);
    });

    it("isTerminalState with lowercase or mixed-case string", () => {
      expect(StateMachineService.isTerminalState("converted")).toBe(true);
      expect(StateMachineService.isTerminalState("Converted")).toBe(true);
      expect(StateMachineService.isTerminalState("closed")).toBe(true);
      expect(StateMachineService.isTerminalState("Closed")).toBe(true);
    });

    it("getNextRecommendedStage with lowercase string", () => {
      expect(StateMachineService.getNextRecommendedStage("collecting_information"))
        .toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(StateMachineService.getNextRecommendedStage("presenting_solution"))
        .toBe(ConversationStage.NEGOTIATING);
      expect(StateMachineService.getNextRecommendedStage("negotiating"))
        .toBe(ConversationStage.CONVERTED);
    });

    it("getObjectiveForStage with lowercase canonical stage", () => {
      const objCollecting = StateMachineService.getObjectiveForStage("collecting_information");
      expect(objCollecting).toContain("Coleta de informações");

      const objConverted = StateMachineService.getObjectiveForStage("converted");
      expect(objConverted).toContain("Conversão concluída");
    });

    it("getAllowedTransitions with lowercase canonical stage", () => {
      const allowed = StateMachineService.getAllowedTransitions("collecting_information");
      expect(allowed).toContain(ConversationStage.PRESENTING_SOLUTION);
      expect(allowed).toContain(ConversationStage.HUMAN_HANDOFF);
      expect(allowed).toContain(ConversationStage.CLOSED);
    });
  });
});
