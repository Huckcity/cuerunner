# [0.8.0](https://github.com/Huckcity/winslab/compare/v0.7.3...v0.8.0) (2026-09-10)


### Features

* cue inspectors, run log, user guide, and a sweep of the options that did nothing ([#61](https://github.com/Huckcity/winslab/issues/61)) ([c30182a](https://github.com/Huckcity/winslab/commit/c30182ab09ebfe0e3f551824ea46b525662c1baa))

## [0.7.3](https://github.com/Huckcity/winslab/compare/v0.7.2...v0.7.3) (2026-09-10)


### Bug Fixes

* **cue-list:** allow dropping the selection so cues can be created outside a group ([#60](https://github.com/Huckcity/winslab/issues/60)) ([ffabdff](https://github.com/Huckcity/winslab/commit/ffabdff72b03e9802c470883ee11e91593bb9794))
* **cue-list:** move a group's children when reordering it ([#59](https://github.com/Huckcity/winslab/issues/59)) ([a271a00](https://github.com/Huckcity/winslab/commit/a271a00dbe1cd437cd26c180fb76261c4e9501ee))

## [0.7.2](https://github.com/Huckcity/winslab/compare/v0.7.1...v0.7.2) (2026-09-10)


### Bug Fixes

* **build:** stop Node 26 zip-extraction deadlock leaving Electron uninstalled ([#57](https://github.com/Huckcity/winslab/issues/57)) ([5e00569](https://github.com/Huckcity/winslab/commit/5e00569c63283343132b5b2bbd80048a8e2de119)), closes [#49](https://github.com/Huckcity/winslab/issues/49)

## [0.7.1](https://github.com/Huckcity/winslab/compare/v0.7.0...v0.7.1) (2026-09-10)


### Bug Fixes

* **linux:** self-healing electron install + AppImage CI ([#49](https://github.com/Huckcity/winslab/issues/49)) ([#56](https://github.com/Huckcity/winslab/issues/56)) ([fd97252](https://github.com/Huckcity/winslab/commit/fd972528b2c0d719758e13f19d09868bfcb86303))

# [0.7.0](https://github.com/Huckcity/winslab/compare/v0.6.2...v0.7.0) (2026-09-10)


### Features

* **script:** add shell() for executing system commands from script cues ([#54](https://github.com/Huckcity/winslab/issues/54)) ([#55](https://github.com/Huckcity/winslab/issues/55)) ([0c1f294](https://github.com/Huckcity/winslab/commit/0c1f29421550a07f800714212020577a9a2ffa11))

## [0.6.2](https://github.com/Huckcity/winslab/compare/v0.6.1...v0.6.2) (2026-09-10)


### Bug Fixes

* **build:** resolve vite peer dep conflict and make midi optional for Linux ([#49](https://github.com/Huckcity/winslab/issues/49)) ([#53](https://github.com/Huckcity/winslab/issues/53)) ([76d0dff](https://github.com/Huckcity/winslab/commit/76d0dffdf3d28d098398b4192411bba5915a0f09))

## [0.6.1](https://github.com/Huckcity/winslab/compare/v0.6.0...v0.6.1) (2026-09-09)


### Bug Fixes

* **build:** add allowScripts allowlist for npm 11.16+/v12 installs ([#49](https://github.com/Huckcity/winslab/issues/49)) ([#52](https://github.com/Huckcity/winslab/issues/52)) ([f9ce926](https://github.com/Huckcity/winslab/commit/f9ce926cd8e3f41bd97e26f7d4c8abba49109107))

# [0.6.0](https://github.com/Huckcity/winslab/compare/v0.5.1...v0.6.0) (2026-09-09)


### Features

* **script:** add include() for executing local JS files from script cues ([#50](https://github.com/Huckcity/winslab/issues/50)) ([41f19ca](https://github.com/Huckcity/winslab/commit/41f19ca760a81b85053e4b0ff5aebabe868b35ee))

## [0.5.1](https://github.com/Huckcity/winslab/compare/v0.5.0...v0.5.1) (2026-09-04)


### Bug Fixes

* **website:** point OG tags at live GitHub Pages URL (apex domain not registered) ([#47](https://github.com/Huckcity/winslab/issues/47)) ([106f642](https://github.com/Huckcity/winslab/commit/106f64212822ae042a526f21dac8ee36934cbc2c))

# [0.5.0](https://github.com/Huckcity/winslab/compare/v0.4.7...v0.5.0) (2026-07-14)


### Features

* **audio:** add real-time adjustable playback rate, trim, and pan controls ([#38](https://github.com/Huckcity/winslab/issues/38)) ([beae2c7](https://github.com/Huckcity/winslab/commit/beae2c709bdf7d28d37747d60682c300c24bb504))

## [0.4.7](https://github.com/Huckcity/winslab/compare/v0.4.6...v0.4.7) (2026-07-11)


### Bug Fixes

* **ci:** trigger Build workflow on release published instead of tag push ([8036654](https://github.com/Huckcity/winslab/commit/8036654d7a7a0ebf4801c1b06c16835684efda35))

## [0.4.6](https://github.com/Huckcity/winslab/compare/v0.4.5...v0.4.6) (2026-07-11)


### Bug Fixes

* **engine:** add configurable timeout to network cue fetch calls ([#4](https://github.com/Huckcity/winslab/issues/4)) ([0826b87](https://github.com/Huckcity/winslab/commit/0826b87c8993db32f339a2e61dc37cf21275eab0))

## [0.4.5](https://github.com/Huckcity/winslab/compare/v0.4.4...v0.4.5) (2026-07-11)


### Bug Fixes

* **toolbar:** use openRecent hook to ensure unsaved-changes guard on recent files ([#5](https://github.com/Huckcity/winslab/issues/5)) ([7fbaa00](https://github.com/Huckcity/winslab/commit/7fbaa00e729945bd1ee0c45e14ca34c80ba07d23))

## [0.4.4](https://github.com/Huckcity/winslab/compare/v0.4.3...v0.4.4) (2026-07-11)


### Bug Fixes

* **audio:** cancel scheduled automations before fade ramps to prevent level drop ([#11](https://github.com/Huckcity/winslab/issues/11)) ([60e0200](https://github.com/Huckcity/winslab/commit/60e02002b126d88a5ff6ddabc99c3921dd63ca8e))

## [0.4.3](https://github.com/Huckcity/winslab/compare/v0.4.2...v0.4.3) (2026-07-11)


### Bug Fixes

* **inspector:** align field labels to left to prevent input misalignment ([#14](https://github.com/Huckcity/winslab/issues/14)) ([749cd87](https://github.com/Huckcity/winslab/commit/749cd8758ec58331b44cbc26cd91ea9f3687573e))

## [0.4.2](https://github.com/Huckcity/winslab/compare/v0.4.1...v0.4.2) (2026-07-11)


### Bug Fixes

* **app:** About window shows correct version ([#19](https://github.com/Huckcity/winslab/issues/19)) ([902ecb3](https://github.com/Huckcity/winslab/commit/902ecb3fb192332b73ebe277823309ea818500b1))
* **ci:** regenerate package-lock.json for npm 11 / Node 24 ([#23](https://github.com/Huckcity/winslab/issues/23)) ([ab33e40](https://github.com/Huckcity/winslab/commit/ab33e40b6a042591673b137036a3b2162c779988)), closes [#18](https://github.com/Huckcity/winslab/issues/18)
* **deps:** Bump vitest to 4.1.10 and @vitest/coverage-v8 to 4.1.10 ([#7](https://github.com/Huckcity/winslab/issues/7)) ([#18](https://github.com/Huckcity/winslab/issues/18)) ([fc9724d](https://github.com/Huckcity/winslab/commit/fc9724d82edee3c4fedc1f381669e1cb2f110072))

## [0.4.1](https://github.com/Huckcity/winslab/compare/v0.4.0...v0.4.1) (2026-07-11)


### Bug Fixes

* **inspector:** Fade cue properties Target dropdown overflow ([#15](https://github.com/Huckcity/winslab/issues/15)) ([#16](https://github.com/Huckcity/winslab/issues/16)) ([8cdbe21](https://github.com/Huckcity/winslab/commit/8cdbe21ffbaaa42a564ad3be32397271cab593bf))

# [0.4.0](https://github.com/Huckcity/winslab/compare/v0.3.0...v0.4.0) (2026-05-03)


### Bug Fixes

* post-wait runs once per cue, not twice when advance=on-end ([7721fd7](https://github.com/Huckcity/winslab/commit/7721fd7233b859d9f1b81fbbec3a7fbf0d1acced))
* seek detects playing state via audioPlayer.isPlaying, not just timers ([4218e1b](https://github.com/Huckcity/winslab/commit/4218e1be163439ee8d23f6133933992bf47fdaae))
* timeline seek correctly resumes in-progress audio/wait cues ([df93328](https://github.com/Huckcity/winslab/commit/df93328c6da036ea1b07c9035c03b56f350020d1))


### Features

* clear seek offset when navigating away from a timeline group ([f0db90a](https://github.com/Huckcity/winslab/commit/f0db90a4dfe2ea28396e130321848f2dd6c492cd))
* functional timeline seek — ruler click jumps playback position ([f98bfcc](https://github.com/Huckcity/winslab/commit/f98bfcc61975c848af2c14ca5dafa6a4b44ffd6c))

# [0.3.0](https://github.com/Huckcity/winslab/compare/v0.2.0...v0.3.0) (2026-05-03)


### Bug Fixes

* require Cmd+Backspace to delete a cue (plain Backspace no longer deletes) ([843a0b2](https://github.com/Huckcity/winslab/commit/843a0b2311e7e261f35aab0246fe89059750c1c2))


### Features

* add right-click context menu on cue rows ([acf12be](https://github.com/Huckcity/winslab/commit/acf12be630a35fbc60c989c7deedbe000b8d7e3b))
* add undo/redo for cue editing (Cmd+Z / Cmd+Shift+Z) ([334ce04](https://github.com/Huckcity/winslab/commit/334ce04b0c8e641f642e995b41716e0f97af1cd6))

# [0.2.0](https://github.com/Huckcity/winslab/compare/v0.1.1...v0.2.0) (2026-05-03)


### Bug Fixes

* **e2e:** resolve strict mode violations in settings tests ([945dceb](https://github.com/Huckcity/winslab/commit/945dceb11de65df7359c37cef424d80031e51eb2))
* range slider track padding and focus blocking transport shortcuts ([1803669](https://github.com/Huckcity/winslab/commit/18036697b085d71fd99ba8c8e36fa016fc67b654))


### Features

* real-time vol/pan updates and pan fade support ([bbe4d38](https://github.com/Huckcity/winslab/commit/bbe4d3827733cd803598d78138549b1fcfb3823f))
* settings dialog with audio output device and MIDI port config ([6c15a07](https://github.com/Huckcity/winslab/commit/6c15a07ef4f9c47020b374cec1aa55dd5db28403))
