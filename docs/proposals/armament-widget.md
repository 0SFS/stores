# Armament widget

The flight HUD keeps weapon selection and firing beside the engine widget. The
existing Armament tab owns loadout editing, rearming, jettison and manual bay-door
controls. This first version runs in `/fly/`; the paired `/rc/` controller is a
separate follow-up.

## Presentation and controls

`armamentWidget` builds a compact native DOM control around an SVG aircraft
schematic, with its nose upward. Numbered station targets use the installation's
station definitions. All stations of the selected type are filled; an outline
marks the next station to fire. Dashed markers identify a carried store without
working release, or an external tank. Empty stations remain hollow.

- Select a weapon type with the arrows, keyboard Y, left bumper or a loaded
  station. Selecting a station chooses its type, rather than a specific rail.
- SAFE / ARM changes the same master arm shown in the Armament tab.
- Fire, Space and right bumper operate only the selected type. Hold for the gun;
  press once per missile. After a missile fires, the next loaded station of that
  type is chosen in station order.
- A press for an internal missile queues one launch, opens the bay and launches
  when the door is ready. Releasing Fire leaves that launch queued. The widget
  shows the bay or gear wait and replaces Fire with Cancel.
- A depleted type stays selected with zero remaining and disabled Fire. It never
  switches to another weapon implicitly. Cycling considers loaded supported
  types; an exhausted gun is omitted.
- The title opens the Armament tab. The trailing accessible **?** explains the
  controls and diagram without adding persistent explanatory paragraphs.

The widget uses the engine widget's dark enclosure and typography, stable DOM
controls, natural wrapping and larger touch controls. When a queued launch
replaces Fire with Cancel, keyboard focus moves to Cancel and returns to an
available control when the queue ends. Help follows the shared tooltip lifecycle.

## Shared state and runtime boundary

`armamentControls` owns supported-type checks, inventory grouping, remaining
counts, initial selection and first-loaded-station resolution. Its
`ArmamentControlsState` carries inventory and external-tank occupancy, selected
type and next station, gun rounds, master arm, firing/pending state, readiness
status and `canFire`. Widget updates are observations; callbacks request actions
from the flight host. The Armament tab uses the same selected type and rules.

The flight app combines widget, keyboard and gamepad trigger sources through one
controller. It preserves a short UI tap between simulation steps, derives shared
readiness and passes exclusive selection into the combat fire control. Firing,
ammunition consumption, projectile behavior, targeting and multiplayer events
remain runtime responsibilities, rather than UI implementations.

Cancellation stops the gun and clears any queued launch synchronously on SAFE,
selection or relevant inventory changes, pause, loss of focus, hidden document,
reset, aircraft switch and disposal. Automatically requested bay openings are
canceled without taking over manual door commands. A trigger held across a
blocking transition must be released before a fresh activation is accepted.
The runtime also validates that a queued station still carries its original
weapon before launch.

## Supported weapons and limits

The working types are the GAU-22 gun pod, AIM-9X, AIM-120 and ASRAAM. Initialization
prefers the first loaded missile type, otherwise an available gun. Weapon
selection is session state; saved loadout formats are unchanged.

Bombs remain visible in loadouts and on the diagram with **Release unavailable**.
Their existing jettison visuals are not a combat release implementation. This
change adds no bomb flight, guidance, impact behavior or new combat protocol.

## Verification

Focused tests cover selection grouping and station advancement; counts and
unsupported stores; type selection in the tab; pointer and keyboard hold/release;
native accessibility activation; pending-launch focus transitions; and help
dismissal. Flight integration checks cover exclusive gun/missile firing,
one missile per press, short taps, release-before-resume and queued-launch
cancellation. Review the widget in Classic and Compact HUD layouts at desktop and
narrow touch sizes, including the empty and bay-wait states.
