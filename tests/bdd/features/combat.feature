Feature: Combat — rule engine invariants in natural language

  The roguelike engine is a deterministic rule engine.
  These scenarios document the key game rules as executable specifications.
  Same techniques apply to payment processors, pricing engines, insurance rule systems.

  # ─── Status effects ──────────────────────────────────────────────────────────

  Scenario: Stun expires after the hero skips one turn
    Given the hero is playing as Paladin against a Guardian
    And the Guardian stuns the hero
    When the hero ends their turn without playing any cards
    Then the hero is no longer stunned

  Scenario: Bleed deals damage each turn and persists without duration
    Given the hero is playing as Paladin against a Necromancer
    And the Necromancer applies 3 bleed stacks to the hero
    When the hero ends their turn
    Then the hero takes 3 damage from bleed
    And the hero still has bleed

  Scenario: Defend absorbs incoming damage before HP
    Given the hero is playing as Paladin against a Goblin
    And the hero has 8 defend stacks
    When the Goblin attacks for 6 damage
    Then the hero takes 0 damage
    And the hero has 2 defend remaining

  # ─── Death's Door state machine ───────────────────────────────────────────────

  Scenario: Hero enters Death's Door when HP reaches zero
    Given the hero is playing as Blood Mage with 4 HP against a Goblin
    When the hero plays Bloodrite
    Then the hero is at Death's Door
    And the hero is still alive

  Scenario: Hero at Death's Door dies on the next hit
    Given the hero is at Death's Door with 0 HP
    When the hero takes any damage
    Then the hero dies

  Scenario: Healing rescues the hero from Death's Door
    Given the hero is playing as Paladin at Death's Door
    When the hero plays Stubborn Recovery
    Then the hero is no longer at Death's Door
    And the hero has more than 0 HP

  # ─── False invariant (documented domain rule) ────────────────────────────────

  Scenario: Healing the Werewolf above 50% HP weakens their attack
    Given the hero is playing as Werewolf with 13 HP out of 30
    When the hero is healed to 16 HP
    Then wolf passive damage bonus is lower than before the heal
    And this is the intended behaviour — healing is not always beneficial

  # ─── Charge accumulation (Paladin) ───────────────────────────────────────────

  Scenario: Paladin charges up to 3 stacks then triggers double damage
    Given the hero is playing as Paladin with 3 charge stacks
    When the hero plays Righteous Strike against a vulnerable enemy
    Then the attack deals 10 damage instead of 5
    And charges reset to 0

  # ─── Berserker Rage Mode ─────────────────────────────────────────────────────

  Scenario: Berserker enters Rage when HP drops to 25% or below
    Given the hero is playing as Berserker with 7 HP out of 28
    Then the Berserker is in Rage Mode
    And all damage cards deal 1.5x damage

  Scenario: Berserker is NOT in Rage at 26% HP
    Given the hero is playing as Berserker with 8 HP out of 28
    Then the Berserker is not in Rage Mode

  # ─── Werewolf transformation ─────────────────────────────────────────────────

  Scenario: Werewolf transforms at the start of a turn when HP is at or below 50%
    Given the hero is playing as Werewolf with 15 HP out of 30
    When the hero ends their turn
    Then the Werewolf has transformed to wolf form

  Scenario: Werewolf does not transform when HP is above 50%
    Given the hero is playing as Werewolf with 16 HP out of 30
    When the hero ends their turn
    Then the Werewolf remains in human form
