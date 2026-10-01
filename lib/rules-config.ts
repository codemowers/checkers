import { isRuleset, type Ruleset } from "./rulesets";

export type RulesConfig = { defaultRuleset: Ruleset; allowSelection: boolean };

export function rulesConfig(): RulesConfig {
  const value = process.env.RULES ?? "english-default";
  if (isRuleset(value)) return { defaultRuleset: value, allowSelection: false };
  if (value === "english-default" || value === "international-default") {
    return { defaultRuleset: value === "english-default" ? "english" : "international", allowSelection: true };
  }
  throw new Error("RULES must be english, international, english-default or international-default");
}

export function rulesetAllowed(ruleset: Ruleset): boolean {
  const config = rulesConfig();
  return config.allowSelection || ruleset === config.defaultRuleset;
}
