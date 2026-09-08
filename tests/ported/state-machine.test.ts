import { describe, it, expect } from "vitest";
import { StateMachineService, STAGE_TRANSITIONS, STAGE_OBJECTIVES } from "../../packages/flow/src/state-machine.js";
import { ConversationStage, CANONICAL_CONVERSATION_STAGES, LEGACY_STAGE_MAP, normalizeConversationStage } from "../../packages/shared/src/enums.js";

describe("StateMachineService Unit Tests (Canonical 8 States)", () => {
  // 1. Sequential Progression (Happy Path)
  describe("Sequential Progression", () => {
    it("should validate the complete sequential sales funnel", () => {
      const canonicalFunnel = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
      ];

      for (let i = 0; i < canonicalFunnel.length - 1; i++) {
        const current = canonicalFunnel[i];
        const next = canonicalFunnel[i + 1];
        expect(
          StateMachineService.validateTransition(current, next),
          `Transition from ${current} to ${next} should be valid`
        ).toBe(true);
      }
    });
  });

  // 2. Branching Transitions
  describe("Branching Transitions", () => {
    it("should allow branching to HUMAN_HANDOFF from intermediate stages", () => {
      const handoffEligibleStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
      ];

      for (const stage of handoffEligibleStages) {
        expect(
          StateMachineService.validateTransition(stage, ConversationStage.HUMAN_HANDOFF),
          `Transition from ${stage} to HUMAN_HANDOFF should be valid`
        ).toBe(true);
      }
    });

    it("should allow branching to CLOSED from any active stage", () => {
      const closeEligibleStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.HUMAN_HANDOFF,
      ];

      for (const stage of closeEligibleStages) {
        expect(
          StateMachineService.validateTransition(stage, ConversationStage.CLOSED),
          `Transition from ${stage} to CLOSED should be valid`
        ).toBe(true);
      }
    });

    it("should allow resuming to QUALIFYING or NEGOTIATING from HUMAN_HANDOFF", () => {
      expect(
        StateMachineService.validateTransition(ConversationStage.HUMAN_HANDOFF, ConversationStage.QUALIFYING)
      ).toBe(true);
      expect(
        StateMachineService.validateTransition(ConversationStage.HUMAN_HANDOFF, ConversationStage.NEGOTIATING)
      ).toBe(true);
    });
  });

  // 3. Self-Transitions
  describe("Self-Transitions (Stage Retention)", () => {
    it("should allow self-transition for all canonical stages", () => {
      const allStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ];

      for (const stage of allStages) {
        expect(
          StateMachineService.validateTransition(stage, stage),
          `Self-transition for ${stage} should be allowed`
        ).toBe(true);
      }
    });
  });

  // 4. Illegal Transitions (Negative Tests)
  describe("Illegal Transition Prevention", () => {
    it("should reject illegal forward skips along the sales funnel", () => {
      // NEW_CONVERSATION cannot skip steps
      expect(StateMachineService.validateTransition(ConversationStage.NEW_CONVERSATION, ConversationStage.COLLECTING_INFORMATION)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.NEW_CONVERSATION, ConversationStage.PRESENTING_SOLUTION)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.NEW_CONVERSATION, ConversationStage.NEGOTIATING)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.NEW_CONVERSATION, ConversationStage.CONVERTED)).toBe(false);

      // QUALIFYING cannot skip to solution or converted
      expect(StateMachineService.validateTransition(ConversationStage.QUALIFYING, ConversationStage.PRESENTING_SOLUTION)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.QUALIFYING, ConversationStage.NEGOTIATING)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.QUALIFYING, ConversationStage.CONVERTED)).toBe(false);

      // COLLECTING_INFORMATION cannot skip to negotiating or converted
      expect(StateMachineService.validateTransition(ConversationStage.COLLECTING_INFORMATION, ConversationStage.NEGOTIATING)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.COLLECTING_INFORMATION, ConversationStage.CONVERTED)).toBe(false);

      // PRESENTING_SOLUTION cannot skip directly to converted
      expect(StateMachineService.validateTransition(ConversationStage.PRESENTING_SOLUTION, ConversationStage.CONVERTED)).toBe(false);
    });

    it("should reject illegal backward regressions", () => {
      expect(StateMachineService.validateTransition(ConversationStage.COLLECTING_INFORMATION, ConversationStage.QUALIFYING)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.PRESENTING_SOLUTION, ConversationStage.COLLECTING_INFORMATION)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.NEGOTIATING, ConversationStage.PRESENTING_SOLUTION)).toBe(false);
      expect(StateMachineService.validateTransition(ConversationStage.NEGOTIATING, ConversationStage.QUALIFYING)).toBe(false);
    });
  });

  // 5. Terminal State Invariants
  describe("Terminal State Invariants", () => {
    it("should enforce zero outgoing transitions for CONVERTED", () => {
      expect(STAGE_TRANSITIONS[ConversationStage.CONVERTED]).toEqual([]);
      expect(StateMachineService.isTerminalStage(ConversationStage.CONVERTED)).toBe(true);

      const otherStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ];

      for (const target of otherStages) {
        expect(StateMachineService.validateTransition(ConversationStage.CONVERTED, target)).toBe(false);
      }
    });

    it("should enforce zero outgoing transitions for CLOSED", () => {
      expect(STAGE_TRANSITIONS[ConversationStage.CLOSED]).toEqual([]);
      expect(StateMachineService.isTerminalStage(ConversationStage.CLOSED)).toBe(true);

      const otherStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
        ConversationStage.HUMAN_HANDOFF,
      ];

      for (const target of otherStages) {
        expect(StateMachineService.validateTransition(ConversationStage.CLOSED, target)).toBe(false);
      }
    });

    it("should report non-terminal stages correctly", () => {
      const activeStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.HUMAN_HANDOFF,
      ];

      for (const stage of activeStages) {
        expect(StateMachineService.isTerminalStage(stage)).toBe(false);
      }
    });
  });

  // 6. Querying Allowed Transitions
  describe("Allowed Transitions Query", () => {
    it("should return exact allowed transition sets", () => {
      expect(StateMachineService.getAllowedTransitions(ConversationStage.NEW_CONVERSATION)).toEqual([
        ConversationStage.QUALIFYING,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.QUALIFYING)).toEqual([
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.COLLECTING_INFORMATION)).toEqual([
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.PRESENTING_SOLUTION)).toEqual([
        ConversationStage.NEGOTIATING,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.NEGOTIATING)).toEqual([
        ConversationStage.CONVERTED,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.HUMAN_HANDOFF)).toEqual([
        ConversationStage.QUALIFYING,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
        ConversationStage.CLOSED,
      ]);

      expect(StateMachineService.getAllowedTransitions(ConversationStage.CONVERTED)).toEqual([]);
      expect(StateMachineService.getAllowedTransitions(ConversationStage.CLOSED)).toEqual([]);
    });
  });

  // 7. Commercial Objectives & Next Suggested Stage
  describe("Commercial Objectives & Recommendations", () => {
    it("should provide meaningful objectives for all 8 canonical stages", () => {
      const allStages = [
        ConversationStage.NEW_CONVERSATION,
        ConversationStage.QUALIFYING,
        ConversationStage.COLLECTING_INFORMATION,
        ConversationStage.PRESENTING_SOLUTION,
        ConversationStage.NEGOTIATING,
        ConversationStage.CONVERTED,
        ConversationStage.HUMAN_HANDOFF,
        ConversationStage.CLOSED,
      ];

      for (const stage of allStages) {
        const objective = StateMachineService.getObjectiveForStage(stage);
        expect(typeof objective).toBe("string");
        expect(objective.length).toBeGreaterThan(15);
      }
    });

    it("should recommend next sequential stages along the happy path", () => {
      expect(StateMachineService.nextSuggestedStage(ConversationStage.NEW_CONVERSATION)).toBe(ConversationStage.QUALIFYING);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.QUALIFYING)).toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.COLLECTING_INFORMATION)).toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.PRESENTING_SOLUTION)).toBe(ConversationStage.NEGOTIATING);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.NEGOTIATING)).toBe(ConversationStage.CONVERTED);

      // Terminal or handoff stages suggest themselves
      expect(StateMachineService.nextSuggestedStage(ConversationStage.CONVERTED)).toBe(ConversationStage.CONVERTED);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.HUMAN_HANDOFF)).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(StateMachineService.nextSuggestedStage(ConversationStage.CLOSED)).toBe(ConversationStage.CLOSED);
    });
  });

  // 8. Normalization & Canonical Stages Helper
  describe("Normalization & Canonical Helpers", () => {
    it("should return exactly 8 canonical stages from getCanonicalStages", () => {
      const stages = StateMachineService.getCanonicalStages();
      expect(stages).toHaveLength(8);
      expect(stages).toEqual(CANONICAL_CONVERSATION_STAGES);
    });

    it("should normalize raw strings and legacy aliases correctly", () => {
      expect(StateMachineService.normalizeStage("NEW")).toBe(ConversationStage.NEW_CONVERSATION);
      expect(StateMachineService.normalizeStage("CONTACT_STARTED")).toBe(ConversationStage.QUALIFYING);
      expect(StateMachineService.normalizeStage("DISCOVERY")).toBe(ConversationStage.COLLECTING_INFORMATION);
      expect(StateMachineService.normalizeStage("QUALIFIED")).toBe(ConversationStage.PRESENTING_SOLUTION);
      expect(StateMachineService.normalizeStage("HANDOFF")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(StateMachineService.normalizeStage("HUMAN")).toBe(ConversationStage.HUMAN_HANDOFF);
      expect(StateMachineService.normalizeStage("CUSTOMER")).toBe(ConversationStage.CONVERTED);
      expect(StateMachineService.normalizeStage("LOST")).toBe(ConversationStage.CLOSED);
      expect(StateMachineService.normalizeStage("NO_RESPONSE")).toBe(ConversationStage.CLOSED);
      expect(StateMachineService.normalizeStage("NOT_QUALIFIED")).toBe(ConversationStage.CLOSED);
      expect(StateMachineService.normalizeStage(null)).toBe(ConversationStage.NEW_CONVERSATION);
      expect(StateMachineService.normalizeStage("UNKNOWN_RANDOM")).toBe(ConversationStage.NEW_CONVERSATION);
    });
  });
});
