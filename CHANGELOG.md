# [0.17.0](https://github.com/Huckcity/cuerunner/compare/v0.16.0...v0.17.0) (2026-10-05)


### Bug Fixes

* **audio-cue:** a cue with no file says so, a picked file names its cue, and an unreadable one says why ([f25671f](https://github.com/Huckcity/cuerunner/commit/f25671f2ce8e3bcb3b8b2302443fdd8cb1b09f36))
* **audio:** the engine's refusal reaches the window with its code ([576265e](https://github.com/Huckcity/cuerunner/commit/576265e88a4372137fcaa7e98858fb40429725f1))
* **cue-list:** a cue that failed says so on its row and on the Log tab ([f21d32a](https://github.com/Huckcity/cuerunner/commit/f21d32af2c1469cb91e2e69aad63cf35ec87ccb9))
* **cue-list:** a duplicate takes the next free number, and a number is drawn on one line ([b006fe5](https://github.com/Huckcity/cuerunner/commit/b006fe562a054a3afe0929f452bab28e25efb3c3))
* **cue-list:** a length is never written with a sixtieth second ([1290d52](https://github.com/Huckcity/cuerunner/commit/1290d52553abc3c5fa3863dbc7ccb1a342fd14cf))
* **cue-list:** a name field opened and left as it was is not an edit ([62e19af](https://github.com/Huckcity/cuerunner/commit/62e19afdf1971e0c0149168d7ba3b9865519e62b))
* **cue-list:** deleting the cue you are on leaves you on the one that took its place ([1bb1f36](https://github.com/Huckcity/cuerunner/commit/1bb1f362f9e3ee36e9ee73f213b80186227b74cd))
* **cue-list:** the drop hint comes down after a file is dragged away, reorder or not ([98a70e1](https://github.com/Huckcity/cuerunner/commit/98a70e129a747f3111c6697028e8c9ac7d11746d))
* **cues:** a new cue takes the next number in the show it is added to ([352f873](https://github.com/Huckcity/cuerunner/commit/352f8738e01ec39fd2994a331fb9017390687964))
* **demo:** the walk-in loops until its fade, so the fade has something to fade ([127df7e](https://github.com/Huckcity/cuerunner/commit/127df7eeb5b41d8f493b85bbad3b3ce0d38bfcfd))
* **engine:** a file that is not there is said to be missing, not the wrong format ([1cc8ee8](https://github.com/Huckcity/cuerunner/commit/1cc8ee898ee7b97fceb2a0fd4c95351f599a4076))
* **engine:** GO skips a disarmed cue instead of stopping on it ([80757ca](https://github.com/Huckcity/cuerunner/commit/80757ca5f556d76a1e9d24f928be9fdeff05ba3d))
* **engine:** on Windows, a path that is not ASCII names the file it names ([32ff396](https://github.com/Huckcity/cuerunner/commit/32ff396abc64b2d15caff0e8ea1ef3d283630c03))
* **engine:** the show clock runs before any engine has answered ([d66e4f2](https://github.com/Huckcity/cuerunner/commit/d66e4f23c761ccb9a6a503560682d22fbf22ddc1))
* **go:** GO fires nothing when nothing is selected, which is where a show stands after its last cue ([79cf22f](https://github.com/Huckcity/cuerunner/commit/79cf22f0b5fcda916fd2f8ec084f6240dc135df8))
* **inspector:** a cue whose target was deleted says so, and a stop reports it ([844e0ca](https://github.com/Huckcity/cuerunner/commit/844e0cae0269e5d71cc799e40a9c1bd335c8ad08))
* **inspector:** a fade is aimed at audio cues, and target lists name cues in full ([026cdbf](https://github.com/Huckcity/cuerunner/commit/026cdbf96e148c063d649933913608fbea8794b7))
* **inspector:** a wait's length is typed in seconds, like every other length ([8b41ed7](https://github.com/Huckcity/cuerunner/commit/8b41ed776a086266767ab71168577b2bac9cd0fd))
* **license:** a key check that faults says so and can be tried again ([410ba78](https://github.com/Huckcity/cuerunner/commit/410ba78baa079e9128d2f6e7b8cc243d9f4681fe))
* **license:** Show Settings carries the Pro mark without a key, and says what it is for ([4329012](https://github.com/Huckcity/cuerunner/commit/4329012d9560491a23294aa2390f5a30ae3e4a78))
* **media:** one list of the audio the window offers, and a refused drop says so ([c7993ac](https://github.com/Huckcity/cuerunner/commit/c7993ac63bd698930af89534b580e94ce1ed7ff2))
* **script:** shell() runs in the folder it is given, dots and all ([63cdcff](https://github.com/Huckcity/cuerunner/commit/63cdcffb0c758dd3b37db4b5111aff8468c60fe5))
* **settings:** the MIDI page says when MIDI is unavailable, and why ([df2c86c](https://github.com/Huckcity/cuerunner/commit/df2c86c6f093fdeeb582da11f97371402fcbd420))
* **toolbar:** a new fade is pre-aimed only at an audio cue ([4647f16](https://github.com/Huckcity/cuerunner/commit/4647f16555d9c27cd09dd83e29502e5f50752d76))
* **toolbar:** adding a fade from a selected cue is one edit ([64453b7](https://github.com/Huckcity/cuerunner/commit/64453b7cc043f97ac03326b857cd5ee0875a8025))
* **toolbar:** Escape closes an open menu instead of stopping the show ([3f9f1fd](https://github.com/Huckcity/cuerunner/commit/3f9f1fd112bc5e76221c6300c7c5faaccee7483d))
* **toolbar:** the Cues/Scenes switch stays on screen in a narrow window and beside a long name ([ab697b6](https://github.com/Huckcity/cuerunner/commit/ab697b64ae580969fc532070e0e7b223c9a90057))
* **transport:** the transport says when the sound is not where it should be ([0a74f53](https://github.com/Huckcity/cuerunner/commit/0a74f5319fcea96fa6f16bbd3127b0cb43b5c8e3))
* **waveform:** the panel's fallback length is the cue's, in the cue's unit ([2e634c0](https://github.com/Huckcity/cuerunner/commit/2e634c00bd161225c790a7a36f3eb32c8c09b6b2))
* **window:** a file dropped outside the cue list cannot replace the window ([1b9a99d](https://github.com/Huckcity/cuerunner/commit/1b9a99d7b4af0e3f73ab4e88ccf590df75585a4c))
* **window:** a recent file's refusal names the file once, and the loop hint sits under its field ([9aea4d6](https://github.com/Huckcity/cuerunner/commit/9aea4d6d73e8aea03f0f19ceb797e593c9e483f4))
* **workspace:** a refused file is refused by Cuerunner, not by WinsLab ([fbdf12f](https://github.com/Huckcity/cuerunner/commit/fbdf12f982347229ef1819915280b3d8dc0ff921))
* **workspace:** a show has one name, and a first save gives an untitled one its file's ([489efb5](https://github.com/Huckcity/cuerunner/commit/489efb5e4da9635e8b9303a657fd324122c5ce19))
* **workspace:** a show that is gone is said to be gone, not "not a show" ([d2cfae4](https://github.com/Huckcity/cuerunner/commit/d2cfae46f159cf3a535471ac74204404c699edcf))
* **workspace:** a show that is replaced stops playing ([95b4853](https://github.com/Huckcity/cuerunner/commit/95b48533ab1a2c1339fbc945e17e2f209ac51c33))


### Features

* **license:** a Pro lock says where a key comes from ([6e5f12b](https://github.com/Huckcity/cuerunner/commit/6e5f12bfbc97d7ce3ce139eda4836bf83a1c1904))
* **window:** the window is sandboxed, and its built page states what it may run ([d3538ae](https://github.com/Huckcity/cuerunner/commit/d3538ae8b64bc544e73bf3b8bfbbfefba185682c))
* **window:** the window opens where it was left ([399fa41](https://github.com/Huckcity/cuerunner/commit/399fa41ff04f6fa34b1a16fa99893adaeca81c44))


### Performance Improvements

* **engine:** the clock is asked for once a second while nothing is playing ([7292b4b](https://github.com/Huckcity/cuerunner/commit/7292b4b8ce945c49fb4b002b56e43485b6de02f6))
* **midi:** the module is asked whether it is there once, not on every cue ([27756e8](https://github.com/Huckcity/cuerunner/commit/27756e8485a72ac36971e9d83ddb0e4fc5df26b3))
* **window:** a write to the store is not everybody's news ([c9dd6f4](https://github.com/Huckcity/cuerunner/commit/c9dd6f42d0e87ffbbf7461ec077bb5e703e10131))

# [0.16.0](https://github.com/Huckcity/cuerunner/compare/v0.15.0...v0.16.0) (2026-10-05)


### Bug Fixes

* **rf:** retry a rename Windows refuses for a moment, and never let a background write crash ([ebbbb47](https://github.com/Huckcity/cuerunner/commit/ebbbb47d56762819f3df356933278f0d8ad87c08))
* **rf:** say so when the keychain will not keep an EW-DX password ([9d0dd7f](https://github.com/Huckcity/cuerunner/commit/9d0dd7fc2c4d9dd319e87654ecadc77892d14eac))
* **rf:** stop alerts stacking for one pack, and follow a receiver by its serial ([9861275](https://github.com/Huckcity/cuerunner/commit/9861275c6d3646d9af50374a5946b3cad8bd95df))
* **rf:** the battery log retries a rename Windows refuses for a moment ([186e531](https://github.com/Huckcity/cuerunner/commit/186e53117770adfa6a3f8a868e2120f256bb3e52))


### Features

* **rf:** a Mic cue that mutes or unmutes a radio mic from the cue list ([e12bc94](https://github.com/Huckcity/cuerunner/commit/e12bc9462746fff03a8ce2f0ef09f071ab133bf9))
* **rf:** a pre-show check of every pack ([46ab614](https://github.com/Huckcity/cuerunner/commit/46ab6149305ac3cf373fa7c0450288c07719a82b))
* **rf:** add an EW-DX receiver and its password in Settings ([0ca112a](https://github.com/Huckcity/cuerunner/commit/0ca112a7b01ef55825d6621c0fb1945f965166e7))
* **rf:** find EW-DX receivers on the network, and keep wireless quiet until asked ([8a93121](https://github.com/Huckcity/cuerunner/commit/8a9312103b916f731b9c19a7d31ff30d4606f406))
* **rf:** read Sennheiser EW-DX receivers over SSCv2 ([ed0f1c7](https://github.com/Huckcity/cuerunner/commit/ed0f1c70d5e8c0d01d119ebc8cdec729501a9d51))
* **rf:** remember what each pack used per show, and warn when a charge will not last ([e5d523c](https://github.com/Huckcity/cuerunner/commit/e5d523cfbe4cbdba95667fcadbfb9eefb70a394f))
* **rf:** say what was playing when a pack had trouble, and report packs with no plot ([f1d01f1](https://github.com/Huckcity/cuerunner/commit/f1d01f14f2bf57a4801604815fcf2d08db49e5c9))
* **rf:** show what an EW-DX receiver itself complains of ([e168e3f](https://github.com/Huckcity/cuerunner/commit/e168e3fdbd47f3dec065b8097c4fa8ddf11f7fae))

# [0.15.0](https://github.com/Huckcity/cuerunner/compare/v0.14.0...v0.15.0) (2026-09-30)


### Bug Fixes

* a refusal speaks, an event field is reported, and a held socket is named ([a71d032](https://github.com/Huckcity/cuerunner/commit/a71d032f400cb3b07ebb478712de8d22a2d17a45))
* an offline desk port drops its latch, a quit states its platform truth, a showless file is refused, a held socket is driven ([bf6f87e](https://github.com/Huckcity/cuerunner/commit/bf6f87e57eb84cee13b65f4450c9712d4fa30417))
* **audio:** a stream slot is published only once its ring is real, and the pool has one lock ([21f178c](https://github.com/Huckcity/cuerunner/commit/21f178cec2aa68621288b50c1834e0051d4e6f39))
* **audio:** an event field is declared with its kind, and a wrong one is reported ([81782a7](https://github.com/Huckcity/cuerunner/commit/81782a794fca265ead4b1e5d33465d83e02f63b4))
* **audio:** the engine's shared state has no data races, and a stop waits for its connections ([7eccb24](https://github.com/Huckcity/cuerunner/commit/7eccb244ac86c74bff92f4b120d8d03ff68e0779)), closes [#172](https://github.com/Huckcity/cuerunner/issues/172)
* **build:** fd-slicer's ReadStream closes, so the zip extraction finishes ([311cffd](https://github.com/Huckcity/cuerunner/commit/311cffd059d52dfe5cd8904db7bec538e6080bed))
* **ci:** Electron's binary, which npm 12 will not fetch by itself ([df9d2aa](https://github.com/Huckcity/cuerunner/commit/df9d2aadaeece8767c357ec2fc2940f0f87e18e0))
* **ci:** every checkout is LF, and the desk goodbye gets headroom ([87ef8d1](https://github.com/Huckcity/cuerunner/commit/87ef8d13d4fae5206f8389edc1edf97fa1500d05))
* **ci:** normalise the checkout, and state the one macOS retry ([79595f8](https://github.com/Huckcity/cuerunner/commit/79595f81e020a950d95411b24dce8edafe0ab994))
* **ci:** removing a file is what makes git write it again ([6f3a647](https://github.com/Huckcity/cuerunner/commit/6f3a647b50aa9dd5ab66693ae09d62e97b9477b0))
* **ci:** the Electron download gets a bounded retry ([99601e1](https://github.com/Huckcity/cuerunner/commit/99601e1288adf5ec6c957d8e631e27f505343240))
* **desk:** a section's absent button fields are unassigned, not a clash ([5c4eb2c](https://github.com/Huckcity/cuerunner/commit/5c4eb2ca2284f9697b0c8e39e26c0c9a36ac6d2d))
* **desk:** one attempt at the desk has a deadline, and a throw is not a wedge ([4e98d94](https://github.com/Huckcity/cuerunner/commit/4e98d9474c27b02e0be7137bd8df9617946c2009))
* **integration:** hold the desk through a relay in the hardware lane ([275180e](https://github.com/Huckcity/cuerunner/commit/275180e38cab89793e5f60935fcbeab925e1a092))
* **integration:** the capture tool refuses a port argument it cannot sweep ([3aa8677](https://github.com/Huckcity/cuerunner/commit/3aa86776b879ca501c21ee5233cfcacaaa84bc87))
* **integration:** the desk fixtures write the shape the show has now ([8eb9f8f](https://github.com/Huckcity/cuerunner/commit/8eb9f8f4f342ac7fc428a57162f16296594ccfa0))
* **recovery:** the lane answers a fault, and asks once per mount ([19aaab7](https://github.com/Huckcity/cuerunner/commit/19aaab7f51e3fe001bffea923d4ec23cdc51008f))
* **release:** give the verify step the Apple credentials it needs ([2964c5f](https://github.com/Huckcity/cuerunner/commit/2964c5f992b5601882825d658c3530c1755f9392))
* **release:** notarise the dmg before stapling it ([018e5ac](https://github.com/Huckcity/cuerunner/commit/018e5ac97ebb0ca2a710396eb4708c1217c1c69b))
* **release:** staple the dmg before validating it ([e50d955](https://github.com/Huckcity/cuerunner/commit/e50d9553f79de3a602a4a2284678934a890a1ad0))
* **review:** the aliases macOS has, and the box the menu hangs from ([dc08a84](https://github.com/Huckcity/cuerunner/commit/dc08a84d385aff6512eff792ea5934deb8a75508))
* **review:** the fold press says what it does, and the fold follow is what the words say ([e3eef99](https://github.com/Huckcity/cuerunner/commit/e3eef994ca1445ee4ea2e829b2701aaa2a6fc2d9))
* **review:** the picker case measures what it claims, on every platform ([52cc2c2](https://github.com/Huckcity/cuerunner/commit/52cc2c26e0faa44f548f7ba7edd038fd5924cb39))
* **scenes:** a scene-less grid keeps its columns ([458e86e](https://github.com/Huckcity/cuerunner/commit/458e86e1d809d459fd155778414b4930a2b8c937))
* **scenes:** the desk record follows the show when a strip or a fader leaves ([685139c](https://github.com/Huckcity/cuerunner/commit/685139c7a29b78a0da0c2a91d2d18bf73579b6ea))
* **scenes:** the grid draws the row a recall writes, not one the file once held ([d46236a](https://github.com/Huckcity/cuerunner/commit/d46236abef1f6427bf3665b32f2b620f0137e39c))
* **scripts:** a local run ships the tree it is looking at ([f87435a](https://github.com/Huckcity/cuerunner/commit/f87435a2b989d393a511ef04b1332dfe7419bd6e))
* **workspace:** a media route the show spells its own way is kept, not rewritten ([231be80](https://github.com/Huckcity/cuerunner/commit/231be80d6b13b29b6903070fe225b94979d78ba5))
* **workspace:** a number the form writes has bounds, and a file outside them is refused ([e755441](https://github.com/Huckcity/cuerunner/commit/e755441676bcff310d3f24a9c682030a086918f0))
* **workspace:** a save writes nothing it will not read back, and says why in a sentence ([8f7c96a](https://github.com/Huckcity/cuerunner/commit/8f7c96a6e5e3dc63174a36d219254a30e9736982))
* **workspace:** the funnel checks a declared cue field's kind ([19a9750](https://github.com/Huckcity/cuerunner/commit/19a97508819316043bdd2970c863de82961f9478))
* **workspace:** the funnel refuses a declared leaf of the wrong kind ([cca9b78](https://github.com/Huckcity/cuerunner/commit/cca9b78c87410d814ba6b2170718187e2daa8978))


### Features

* **demo:** the demo ships its scenes and its writer, and a new workspace folds the dock ([8234fa4](https://github.com/Huckcity/cuerunner/commit/8234fa4fcc8d5476af02ca1b527bc9c8a8baa913))
* **desk:** a press that only means “next cue” does not have to latch ([b66a65b](https://github.com/Huckcity/cuerunner/commit/b66a65b709d5dd17541b28a24d0cbee04cca29a2))
* **desk:** a scene owns the assignment, and a recall writes only what it names ([95a8499](https://github.com/Huckcity/cuerunner/commit/95a84993cbc62b0756ce56820f4d4d202a034702))
* **desk:** the SQ's native control service speaks its measured frames ([9894d6e](https://github.com/Huckcity/cuerunner/commit/9894d6e2cd1f289d7ad01c13a4128d95e99bd770))
* **harness:** the SQ's native service is captured, and a DCA assignment measured ([60e9377](https://github.com/Huckcity/cuerunner/commit/60e9377dca0accec3e58e2ac948e45ee5d024b85))
* **integration:** the capture runs in the fast lane, and the SQ claim stays unproven ([d57ffed](https://github.com/Huckcity/cuerunner/commit/d57ffedb1277dda318e70b57eca584c1175517a1))
* **release:** the mirror serves one release, and the digests ship beside it ([373eb52](https://github.com/Huckcity/cuerunner/commit/373eb52727da3cbe301ed405929990fd9e81f445))
* **release:** the Windows installer signs through Azure Trusted Signing ([3c7c9b4](https://github.com/Huckcity/cuerunner/commit/3c7c9b40b90115eda42293e17ca2185457c328f6))
* **report:** Report a Problem builds a report the operator reads before it leaves ([3a59f7e](https://github.com/Huckcity/cuerunner/commit/3a59f7ea06381ebc3d50b7583b46e93fed5cdc34))
* **scenes:** a group holds strips, so any strip can be grouped ([968b157](https://github.com/Huckcity/cuerunner/commit/968b157b4cc8f11264e35a93528048fe440f18ec))
* **scenes:** a row holds one thing, and a fader is its number ([d9fe38c](https://github.com/Huckcity/cuerunner/commit/d9fe38ca0179b30e5b2c80d6d8dd2674a2e20d3c))
* **scenes:** a row that holds something is its name, and the columns are narrower ([19dd39e](https://github.com/Huckcity/cuerunner/commit/19dd39eb05e8cd357d741a2e5ce852d11b322522))
* **scenes:** keep grid readable and clarify ensemble creation ([93a5e35](https://github.com/Huckcity/cuerunner/commit/93a5e357a16b8f77553e440dea028e75d4b3a6cd))
* **scenes:** one box per cell, and an ensemble built from the strips it names ([5a0e95a](https://github.com/Huckcity/cuerunner/commit/5a0e95ae7fd4e453db1268df596cc6b233f3561a))
* **scenes:** the builder holds its size, and its place ([423ae65](https://github.com/Huckcity/cuerunner/commit/423ae65b48034e44eed2cbc20ca7063e991e5fb6))
* **scenes:** the grid is the whole view ([f5a78c6](https://github.com/Huckcity/cuerunner/commit/f5a78c635f734770aa9f7e35714e9c56005f83ff))
* **scenes:** the grid's chrome is the grid, and the colour is free ([e67e21e](https://github.com/Huckcity/cuerunner/commit/e67e21ed91006c09e94c7793b8866e06e7a1eae6))
* **show:** the channel set is a count, and a shrink takes what named it ([e3c96e1](https://github.com/Huckcity/cuerunner/commit/e3c96e14d442c29c1cd1547319a965f57ae3e829))
* **site:** the code samples keep their lines and mark their edges, a printed table fits its column, and the served pages' app words are the app's own ([ba72773](https://github.com/Huckcity/cuerunner/commit/ba72773225056a4916609c95c5d3cdecfe38bbc3))
* **site:** the Pro marks and the app's labels are held to the record, and the reference covers the License tab ([82d4ee1](https://github.com/Huckcity/cuerunner/commit/82d4ee1938204b5aeb423b20a22397db5d006fc9))
* **workspace:** the funnel checks the shape instead of carrying the old ones ([e0ab583](https://github.com/Huckcity/cuerunner/commit/e0ab583d726025d73d5ce746c9295de0a684ab6f))


### Reverts

* **ci:** the macOS retry, which a deterministic failure ignores ([d72493f](https://github.com/Huckcity/cuerunner/commit/d72493f5cf6a7e2740863f6b7f8fc315465217b6))

# Unreleased

### Bug Fixes

* **packaging:** no comment keys inside electron-builder's config ([44608ff](https://github.com/Huckcity/cuerunner/commit/44608ff68342fe90bbd28a8640836b6e3b57e69b))
* **packaging:** the mac dmg's engine is built for both architectures ([9919b28](https://github.com/Huckcity/cuerunner/commit/9919b2807c1b574d32125e361c8a4229dbab18f5))

### Features

* **desk:** a scene owns the DCA assignment — the show sets up a channel count and one desk number per fader, and the Scenes grid puts one channel or one ensemble on each row of each scene
* **desk:** a recall writes the membership first and then each mic's mute, one awaited write at a time, and addresses nothing outside the show's controlled channels: a channel the scene places is open, one it leaves off every fader is closed, and a mic that changes fader keeps playing and takes the new fader's position
* **desk:** an SQ's membership rides the desk's own control service — TCP 51326 outbound, held with a keepalive datagram to the desk's UDP 51324 — with the frames measured from an SQ-6 on firmware 1.6.1 and replayed by the peers lane; the mutes stay on the MIDI service on 51325, and an Avantis takes its membership as NRPN `40` on the desk link
* **desk:** the desk's GO and BACK keys have a second route beside the mute groups: a soft key set to `MIDI Note` transmits note on while it is held, so a press steps the show once and nothing is left lit at the desk — the two notes are set beside the groups in Show Settings → Channels, and the fields are offered only where the desk's own traffic cannot be a note
* **scenes:** the grid is the whole view — the bar over it (the title, the fader and scene counts, the desk's `now`/`next` readout, the editing hint and the `Add scene` press) is gone, so what is left is the grid: `All closed` is renamed `Out`, the mode is a padlock drawn in its top-left corner, and `+` after the last scene adds one
* **scenes:** the column the desk is on carries the running colour down its own header box rather than a wash over the column, so the cells say only what a scene holds
* **scenes:** colour is left to the cells: the pending amber, the green wash down the recalled column and the running-colour edge on a held row are gone, and the recalled scene is marked in its own title box; a group's block is outlined in the same ink as everything else, and its member list is in its title
* **scenes:** a scene column is a fixed width and the grid scrolls inside the view rather than stretching two scenes across the window
* **scenes:** a row of a scene holds exactly one thing — a strip of the console, or an ensemble over several of them — so a cell is that one block and nothing else: an empty row is a blank box, a row that holds something is its name across the whole cell, and pressing either is what changes it. The picker behind it filters the strips and the groups as it is typed, and the builder at `Ensemble…` names a group and fills it from the strips moved across its two lists, putting it on that row in one undo
* **scenes:** the columns are narrower and measured rather than guessed — 176px of scene, an eighteen-character scene name in the header's own font, and 88px of the all-closed column
* **scenes:** the builder holds its size — its two lists are a fixed number of rows taken from the show's strips, so moving one across cannot walk the box up or down under the pointer — and the press keeps the place: the next strip in the list is picked after a move, so a group is filled by picking and pressing rather than by reaching back to the list between every one
* **scenes:** the builder is the one place a group is named and filled — opened from a row holding a group it edits that group, `Save` changing it on every row that holds it, and `Delete` removing it; a group holds **strips**, so any strip of the show can be grouped whether or not anybody is cast on it
* **scenes:** an ensemble's block says which strips it opens in its title, so a row reads as what is open without becoming a list of a dozen names
* **scenes:** the ✕ that empties a row is drawn only while the grid is unlocked — a press that does nothing is one the operator has to read to find out it does nothing
* **scenes:** a strip is named the way the operator knows it — the name the strip was given, or the performer whose mic is on it, and its number only while it has neither — in the blocks, in the picker and in the builder; the console's own `Ch 3 · Ruth` stays where the desk is spoken about, in the run log, the change list and the scene inspector
* **desk:** a fader is its number: the fourth fader of the show is its fourth fader in every scene, and the Scenes grid's rows, the run log and the fader list in Show Settings all name it that way
* **workspace:** a settings field is checked for the kind its own type writes and not only for its name, so a leaf carrying another JSON kind — a string where this build writes a number, a number where it writes a list of strings, an entry of that list that is not what the list carries — and `null` where the show's types allow no such thing are refused as the file opens, naming the field and the kind the file carried. A show saved with one is refused by name, as every retired shape is
* **workspace:** a cue's declared fields are checked for the kinds their own types write and not only for their names — a number where a MIDI cue writes a list of messages, an entry of that list that is not an object, a string where a crosspoint writes a number, a value whose type allows several kinds and carries none of them, and `null` where a cue's own types allow none — so a show carrying one refuses with a sentence naming the cue, the field's path and both kinds rather than faulting in the reader that dereferences it. A field a cue carries that this build does not declare, `media` among them, is kept, and a cue missing a field its own type requires refuses as it did
* **dock:** the fold follows the workspace until the operator says otherwise: a show with no cue in it opens with the dock folded away to its tabs — nothing to show, so the cue list has the room — and the dock comes back when the list has something in it. Nothing is written down until the operator presses the chevron or a tab, and from then on their fold is the dock's wherever a workspace is opened, so the demo show opens with the dock it did before. The fold press is keyed to what is drawn and is not offered in the Scenes view's Cue tab, where no press could show anything
* **demo:** the demo show ships the scenes it is run from — Act One and Wedding, four strips each on the console's own faders — so the Scenes view has a show in it the moment the demo is opened, and the guide's figures are captured from it rather than built in the capture
* **tooling:** the demo show has a writer — `npm run demo:write` puts the shipped `.cuerunner` through the serialiser (this build's settings defaults, each audio cue's route pair against the folder the show ships in, the keys in the declared order) and `npm run demo:check` stays red while the file is in a form the writer would not produce. The bytes come from the module the app's own save path uses: `serialiseWorkspace` moved to `src/main/workspace/serialise.ts`, which reaches nothing but `node:path` and the shared declarations, so the recipe runs under plain Node and there is no second writer to drift from

### Removals

* **scenes:** `Resync` — the full re-send of the standing scene, for a desk somebody has moved by hand — is deleted with its engine path: what a recall sends is the difference against what Cuerunner last sent, and that record lives as long as the show is open, so a fader or mute moved by hand at the desk is now repaired by reopening the show rather than by a press

* **scenes:** the `Place channel` and `Apply ensemble` selects and the `Create ensemble` press are deleted rather than left beside the box: one blank box opens everything a row can hold, and the group a row folded into itself one press is built in the builder now
* **cast:** an ensemble no longer holds performers: it holds the strips it opens (`members` became `channelIds`), so a show that has never cast anybody still has groups, and a strip that leaves the console leaves every group it was in. A show saved with the old field is refused by name, as every retired shape is
* **scenes:** a member can no longer be left off an ensemble on one row — a row holding a group opens all of it, and the amber `partial` state and the per-member exclusion list go with the presses that made them — and a row holding several channels is no longer a shape a scene can carry: the file's placement now names one member
* **show:** an ensemble is no longer a section of Show Settings → Cast: the Cast tab is the people and nothing else, and the groups they are opened in are built from the rows they ride
* **show:** a DCA has no operator-written name: a fader is a number, and a show saved with a fader label is refused when it is opened rather than converted
* **show:** the per-channel fader select and the per-DCA note and address overrides are deleted rather than deprecated: a strip is a name and a number, a fader carries one desk number, and a show saved with either shape is refused by name rather than converted

# [0.14.0](https://github.com/Huckcity/cuerunner/compare/v0.13.0...v0.14.0) (2026-09-21)


### Bug Fixes

* **audio:** a refusal crosses the boundary as a value, not a rejection ([dcdb940](https://github.com/Huckcity/cuerunner/commit/dcdb940c016effb40844f1ccd3a8576dbf810f96))
* **audio:** a split's tail fires nothing, and a lost release lets go ([f5722ba](https://github.com/Huckcity/cuerunner/commit/f5722ba5e4473d0ad456c686c15f461206294049))
* **audio:** detach connection threads without touching freed clients ([dfb85a7](https://github.com/Huckcity/cuerunner/commit/dfb85a7a23422502708aadce4f30c87f089c4c91))
* **audio:** kill the decoder before closing its pipe ([a412dcd](https://github.com/Huckcity/cuerunner/commit/a412dcd23e34701910173905b538c01663155742))
* **audio:** recover a lost device and a spent engine from configure ([133b3f6](https://github.com/Huckcity/cuerunner/commit/133b3f63ded6bb85c48f9008685e5f076e1788b2))
* **audio:** refuse an unavailable backend before tearing the device down ([16dd1a9](https://github.com/Huckcity/cuerunner/commit/16dd1a909ec1c859986d80c88a849e10492d1385))
* **audio:** remove device failure deadlock and background ack waits ([20a0656](https://github.com/Huckcity/cuerunner/commit/20a065609e11b2dfb550a59e797beebe5730098a))
* **audio:** the clock a rate change steps, the quit that cannot be cancelled, and a ([e2acf79](https://github.com/Huckcity/cuerunner/commit/e2acf79dfaf3160c0426047b34c07f74458e8b2d))
* **audio:** the engine names its session, so its clock survives a restart ([e12b4a8](https://github.com/Huckcity/cuerunner/commit/e12b4a82706bef77fc5d40d56ff772f5ee3dfe85))
* **audit:** A2.4-A4.4 ASIO list, quit teardown, SysEx, merge cancel, store integrity ([05ebace](https://github.com/Huckcity/cuerunner/commit/05ebace0b69f4c17dc0a421f1fce1df4b0ec8599))
* **audit:** A5 save round-trip, recovery guard/history, atomic snapshot and bundle ([596c252](https://github.com/Huckcity/cuerunner/commit/596c25229728cade578b3a988c0a935e8a670b94))
* **audit:** A6 stop targets, stuck groups, note-off triggers, stale run lines ([3167f3d](https://github.com/Huckcity/cuerunner/commit/3167f3df3d2c2d19ace3522e270eb55a87c54b09))
* **audit:** A7 redundancy status, MIDI offline rows, scoped restarts, A8 rename keys and backend note ([24d1a69](https://github.com/Huckcity/cuerunner/commit/24d1a6975ef2760877d2998a149aa3f82df2fa3b))
* **audit:** A8bis universal dmg, MSVC rules flags, smoke outputs, soak figures ([0f2be94](https://github.com/Huckcity/cuerunner/commit/0f2be948de43d46f081eaa0e0200ba32e2f01a4a))
* **audit:** B1 trust boundary docs, B2 archive and workspace bounds ([db5ab94](https://github.com/Huckcity/cuerunner/commit/db5ab94e03124ebb7e5f3f891293f9421d2b4225))
* **audit:** B2 cap deflated showfile inflate output ([216ea04](https://github.com/Huckcity/cuerunner/commit/216ea04abfcef4b4a7914d9e8a7e93d363ecc6b4))
* **audit:** B3 group-stop settling, playlist interlock in goById, and the tests that found them ([debaad3](https://github.com/Huckcity/cuerunner/commit/debaad30ff29179692f75b831b2287027579d057))
* **bundle:** an unreadable media file fails the export instead of hanging it ([42d9832](https://github.com/Huckcity/cuerunner/commit/42d983298db28b4b719ee56c98ee24956d04a716))
* **ci:** every action on its own runtime, and a Windows log that is about the run ([e5e3894](https://github.com/Huckcity/cuerunner/commit/e5e3894d12b7217b8900ec4520703e8f9ba69934))
* **ci:** quote the vendor lane's grep tag so pwsh stops splatting it ([f8f1d3c](https://github.com/Huckcity/cuerunner/commit/f8f1d3c900c17c4c6394b725e1dad78244e9b774))
* **ci:** restore what the last workflow edit deleted, and publish a red night ([10209aa](https://github.com/Huckcity/cuerunner/commit/10209aa3f2c866c83408f124fdfe74e4ba4d45bf))
* **ci:** set up MSVC in the vendor lane, as the other Windows lanes do ([d07ef7a](https://github.com/Huckcity/cuerunner/commit/d07ef7a7df822438328ace51a61981055f22a998))
* **ci:** the package steps stop racing each other for the dpkg lock ([7849b50](https://github.com/Huckcity/cuerunner/commit/7849b50b93ada4283c7bd48737f31a0ba6291733))
* **ci:** the signing steps stop asking for secrets in an if: ([12f2580](https://github.com/Huckcity/cuerunner/commit/12f2580fd3365e4e9423a82be0d9d73342eb68d7))
* **ci:** the website deploy uploads the site and deploys it again ([05210d8](https://github.com/Huckcity/cuerunner/commit/05210d84139ab0b7ab1d978403439a31bac0ce3d))
* **desk:** the buttons walk the show's scenes, and a button is a change ([fe016b9](https://github.com/Huckcity/cuerunner/commit/fe016b9fe783ae0c058379ec12bc8e3575e49d17))
* **dock:** a height the operator set survives the window coming up ([8301169](https://github.com/Huckcity/cuerunner/commit/8301169e0c4634eef36d52db9a50ab7d9eb020fe))
* **docs:** the guards cover the paths they claim, and the copy stops overreaching ([7eeb8a7](https://github.com/Huckcity/cuerunner/commit/7eeb8a7ce885673174ae1bb23597bcd965d1a492))
* **e2e:** closing an app twice is not a failure ([ca72033](https://github.com/Huckcity/cuerunner/commit/ca72033b8df3afaf9392ff5b4ec91df193aa18f2))
* **e2e:** run the Playwright CLI directly, not through npx ([a88ebde](https://github.com/Huckcity/cuerunner/commit/a88ebdeba2a0456270609d7d7130edbdd7c786f1))
* **e2e:** the Windows tee drops Node's per-launch line ([f98d557](https://github.com/Huckcity/cuerunner/commit/f98d557f7162c9b19a2314592d97c3b862eb77e7))
* **e2e:** wait for the saved file rather than reading it once ([1f321fa](https://github.com/Huckcity/cuerunner/commit/1f321faa0ee3e8063722682a2f4d59d9f8d0fc6b)), closes [#127](https://github.com/Huckcity/cuerunner/issues/127)
* **engine:** a device fault releases the show when it happens ([b6b74ec](https://github.com/Huckcity/cuerunner/commit/b6b74ec22c225bb1f123b50286b3b13e54249097))
* **engine:** a file scan does not hold the verbs that run the show ([b88265a](https://github.com/Huckcity/cuerunner/commit/b88265a031db38efe519689cb3c306fbf2ada457))
* **engine:** a long WAV is a WAV — RF64 and Wave64 are read as one ([0725e4f](https://github.com/Huckcity/cuerunner/commit/0725e4f8a330f274971bc44a699f2e59b8e61f80))
* **engine:** a stop that names a cue which has not begun takes it away ([95f3fc7](https://github.com/Huckcity/cuerunner/commit/95f3fc794d945de4cc117093f7315bd5d8927cde))
* **engine:** include <new> for std::nothrow ([4611a67](https://github.com/Huckcity/cuerunner/commit/4611a6713dc093fc7ebc470ede0e8364123141c1))
* **engine:** measure a long file once, and never hold the show on a read ([a8454a0](https://github.com/Huckcity/cuerunner/commit/a8454a0bc71f755e276170713024a7396037c349))
* **engine:** overlap the Windows pipe so a broadcast cannot wait on the next verb ([27353fc](https://github.com/Huckcity/cuerunner/commit/27353fc8d99cafc2a406e2f16d0b829f731c3c94))
* **engine:** prime both halves of the ASIO double buffer at start ([9c39a58](https://github.com/Huckcity/cuerunner/commit/9c39a583db4c9bb415939c9a748bc7717fec4e01))
* **engine:** the advance, the routing, the timeline start and the replaced run ([35d1b34](https://github.com/Huckcity/cuerunner/commit/35d1b34cd29aa4bd81117ccf6538aae148f9d1b2))
* **engine:** the ASIO backend owns the apartment it needs ([a5fec6b](https://github.com/Huckcity/cuerunner/commit/a5fec6b183e44b22c2cab1ca0bcf7687fea33175))
* **engine:** the ASIO driver keeps its callback table, and the thread race ([9d93a8f](https://github.com/Huckcity/cuerunner/commit/9d93a8f49151664b17e2c9af513f3fe81b00131f))
* **engine:** two COM lifetime faults the Windows driver found ([5d143e9](https://github.com/Huckcity/cuerunner/commit/5d143e9e559a6c2eae93dd503e6c2e5061f5fb83))
* **harness:** a sound desk has no GO key, and does not send show control ([9240bdd](https://github.com/Huckcity/cuerunner/commit/9240bdd1613cdd7ed65ab3f0e4d82629c6e994f8))
* **integration:** a console answers from wherever it likes, so route by what it says ([e119235](https://github.com/Huckcity/cuerunner/commit/e119235efa5a07c39572e99ec758cfb94ff19ff7))
* **integration:** the desk gets one destination, and the lane arranges itself behind it ([828d10c](https://github.com/Huckcity/cuerunner/commit/828d10c405985d06ab537a8380a12b35dbe88280))
* **integration:** the vendor lane's environment, and the launcher's real path ([83faf03](https://github.com/Huckcity/cuerunner/commit/83faf031f93be7d9254bef26e3602a31a37a8475))
* **integration:** the vendor lane's ports are settings somebody types once ([369beb2](https://github.com/Huckcity/cuerunner/commit/369beb2e446a5b14cd1df57a01d16e49dacebd51))
* **licence:** the locks read right on screen ([de79230](https://github.com/Huckcity/cuerunner/commit/de7923082e180fe8e0b9c57a9cedb434c3615837))
* **log:** a service starting and stopping stays in the monitor ([cf970c2](https://github.com/Huckcity/cuerunner/commit/cf970c2455283472b07180fde137088c13e45291))
* **main:** keep the desk awake, so its timers are not napped ([9d6bb3d](https://github.com/Huckcity/cuerunner/commit/9d6bb3df6a8233b610af7434dfd3328d4780195a))
* **merge:** an arrangement one side made is theirs to keep ([7b47466](https://github.com/Huckcity/cuerunner/commit/7b47466f8b9e802dc577c46c39085b84f67f0fe4))
* **native:** a corrupted media file is refused, not an abort ([a1ea67a](https://github.com/Huckcity/cuerunner/commit/a1ea67a6f4fec06bc556ac75ee4e2927acf81bd4))
* **native:** a seek the pre-roll covers is served by the pre-roll ([05ad64b](https://github.com/Huckcity/cuerunner/commit/05ad64b8f0b2a4d47291d0b6d3dbcf42be31781b))
* **native:** a streamed start is positioning, not starving ([03eceee](https://github.com/Huckcity/cuerunner/commit/03eceee3155aa5da528c5ac025072fb5bc296013))
* **native:** a streamed voice follows its position, and a WAV seek reports the truth ([2637fa6](https://github.com/Huckcity/cuerunner/commit/2637fa6a85f15ab0ca077e9e2f7952e0ee4cc80f))
* **native:** a streamed voice slower than real time is not starved ([66b9dd6](https://github.com/Huckcity/cuerunner/commit/66b9dd6d9d34972838a27fbf29e01ffb77472f4f))
* **native:** an explicit matrix is applied as written, and applied once ([f7d0509](https://github.com/Huckcity/cuerunner/commit/f7d0509f5f11af512d205e8be39483c69cd442e1))
* **native:** include what each engine header uses ([08033fe](https://github.com/Huckcity/cuerunner/commit/08033fec701842a0d85bea583f196987e6a29771))
* **native:** keep windows.h's min/max macros out of the engine ([e164ac6](https://github.com/Huckcity/cuerunner/commit/e164ac6c8d093a06e7c554696c0b5dd2cf6532ae))
* **native:** name Windows objects by file, and find MSVC on PATH ([e09b44e](https://github.com/Huckcity/cuerunner/commit/e09b44eff6182ed59af2a0210231241199feb540))
* **native:** the engine is built on the heap, not on a one-MiB stack ([d4ea050](https://github.com/Huckcity/cuerunner/commit/d4ea0500e9ed51effd71301bfe88d89e89b4eb75))
* **native:** the silent pacer repays the wall time it loses ([4d8179a](https://github.com/Huckcity/cuerunner/commit/4d8179aa7453d7494d60372331b41a3c1ae073ea))
* **native:** the Windows engine hands out one readable pipe instance ([7aad479](https://github.com/Huckcity/cuerunner/commit/7aad47972ce53e19d2774d02c6ee8e51cca0563a))
* **playback:** move a run's end with a slow prepare's late start ([50dfa4a](https://github.com/Huckcity/cuerunner/commit/50dfa4a362f797ea8885ecce56a884f00788ed0a))
* **playback:** prepare an audio cue before the engine is asked to play it ([371a323](https://github.com/Huckcity/cuerunner/commit/371a323f04f4f4c7eaf08fd82f1824a56deaad71))
* **redundancy:** a takeover stops what the standby was playing by hand ([d95ad07](https://github.com/Huckcity/cuerunner/commit/d95ad071d94b8c1437117636f049e7abed1abc66))
* **redundancy:** a vamp picks up inside its loop, not past the end of it ([fa179c6](https://github.com/Huckcity/cuerunner/commit/fa179c6e298eadd0c21bc350ee572bb51297d95f))
* **redundancy:** count the decisions rather than the terms ([07776fa](https://github.com/Huckcity/cuerunner/commit/07776fac62692c265c14a7299afd923176800e9d))
* **redundancy:** greet only a peer that has proved it knows the token ([20164d2](https://github.com/Huckcity/cuerunner/commit/20164d2a7803578a074dbd54edf661279cbafd75))
* **redundancy:** the machine that handed the show back says so in its own words ([c60a135](https://github.com/Huckcity/cuerunner/commit/c60a1359c9b086010095493b21814c1cb10cfa05))
* **redundancy:** the panel asks what it is watching, instead of the log being told ([eba1be0](https://github.com/Huckcity/cuerunner/commit/eba1be090d25e538e4afc609a93fcdb25fc890c5))
* **redundancy:** warn about a missing token once, not on every start ([e68f110](https://github.com/Huckcity/cuerunner/commit/e68f11062f6525b49a0c08fd353028ca10bb3a0a))
* **reliability:** a night that produced no reports says so, instead of zeroes ([17edad3](https://github.com/Huckcity/cuerunner/commit/17edad3c032aec7c216128850726e0e3d6843d47))
* **safety:** the panic broadcast takes the same guard ([e710e9f](https://github.com/Huckcity/cuerunner/commit/e710e9f81cc7f28e3bd2474d3fea025e53807ca5))
* **script:** refuse a document the panel cannot show ([19983a8](https://github.com/Huckcity/cuerunner/commit/19983a890b353cdc90ec1d59922937f50b51a178))
* **services:** a recall reported sent that never went, a pair that cannot recover, ([9a4bf34](https://github.com/Huckcity/cuerunner/commit/9a4bf344e76135a9a479aad240278d604d9ea2c5))
* **settings:** the panel keeps its place, and only its own ways close it ([ce9b14d](https://github.com/Huckcity/cuerunner/commit/ce9b14d589f6156c846892b461d56b6c10f1dd86))
* **show:** a configure arriving mid-apply is applied after, not dropped ([1cc3027](https://github.com/Huckcity/cuerunner/commit/1cc3027dcf0e089e1dd2c0f8293e69166ba9a2b3))
* **showfile:** the history travels with a recovered session too ([d9fd759](https://github.com/Huckcity/cuerunner/commit/d9fd759ecfdd64235752223bc13ef8b69182ed86))
* **show:** four ways the licensed half could be wrong on the night ([d989880](https://github.com/Huckcity/cuerunner/commit/d98988060d85c6659d2b160b48bd14c6525caa46))
* **site:** reach the boundary page, and finish the sweep in the places it missed ([8362b5b](https://github.com/Huckcity/cuerunner/commit/8362b5b42e90cc226f00da4318eed1ba00ba376f))
* **soak:** a finding is reported when it grows, not on every poll ([9ae2a40](https://github.com/Huckcity/cuerunner/commit/9ae2a40b592d25474874387ab1945e7cba9b4988))
* **store:** the pair that runs backwards, the drag that eats the history, and a ([b4ef603](https://github.com/Huckcity/cuerunner/commit/b4ef60347ecd1ede80ee091af73a852d8ff28feb))
* **toolbar:** the list presses leave with the list ([5aed5c1](https://github.com/Huckcity/cuerunner/commit/5aed5c1721862990a2f9e81582e4d250066d056e))
* **ui:** a header rename that deleted another header, and two unbounded reads ([a91eedb](https://github.com/Huckcity/cuerunner/commit/a91eedb34558b3703df1b72c2b562e9ffc23a01f))
* **ui:** a rename that a save undid, a drop that joined the trailing group, and a ([302b5db](https://github.com/Huckcity/cuerunner/commit/302b5dbc186e61b25e2869e3032c22597c67506d))
* **ui:** the bytes shown in the wrong base, the Learn that goes deaf, and a string ([d2c8a8b](https://github.com/Huckcity/cuerunner/commit/d2c8a8b6e481e4949fe1c19f1beb1c5ec6cf1b0a))
* **ui:** the crash notice stops writing off work the autosave caught ([f142b87](https://github.com/Huckcity/cuerunner/commit/f142b872531829489df96445e5247a278d178506))
* **ui:** the cue list keeps to the window, and the specs say what they saw ([b79111a](https://github.com/Huckcity/cuerunner/commit/b79111a5843ae5ccce24d421272dcee2a5214534))
* **ui:** the frame, the escape, and the name a split keeps ([7ed8b74](https://github.com/Huckcity/cuerunner/commit/7ed8b74cf366aa9eb7b47e3e6e7d8efb55accd1d))
* **ui:** the keyboard, the focus, and what the panel is telling you ([f27b73f](https://github.com/Huckcity/cuerunner/commit/f27b73fecb3e09cc7a461dc43f97f8d2d845cc11))
* **ui:** the panel stops moving under the operator, and the toolbar fits ([1877b93](https://github.com/Huckcity/cuerunner/commit/1877b93c79a5df15e80aa191d4c4e7034cfcfdb0))
* **ui:** the recovery bar names the cue the session was standing on ([d88e3f3](https://github.com/Huckcity/cuerunner/commit/d88e3f3db2b51b3f81e0226a33476d3e6749f3c5))
* **ui:** the window says things the way this machine and this show read them ([61fe6ab](https://github.com/Huckcity/cuerunner/commit/61fe6aba07bd8260058ec64d2008930192d2a315))
* **website:** text fills its block, and the home page shows the app ([7592918](https://github.com/Huckcity/cuerunner/commit/75929185d9feff96618e9b0c5e61766fad3e1b27))
* **wireless:** a quiet pack is a warning, and the thresholds are a setting ([803468a](https://github.com/Huckcity/cuerunner/commit/803468ac830c11679d2f875e04419aaebeaf38a5))
* **workspace:** an archive that writes until the disk fills, a load that takes the ([ba19f87](https://github.com/Huckcity/cuerunner/commit/ba19f878bd2cb54b888d560a924bd90a50dc4e85))
* **workspace:** saving a show does not rewrite the show ([2726975](https://github.com/Huckcity/cuerunner/commit/2726975c34e6d1faa3fcfded52b067ddd6230eff))
* **workspace:** the saved media route stays portable ([9ec32e2](https://github.com/Huckcity/cuerunner/commit/9ec32e2b2592c98b67ac963820a17569c4a454b4))


### Features

* **audio:** a cue at another rate says so ([e12d0a0](https://github.com/Huckcity/cuerunner/commit/e12d0a0e40908f15691c36cc58fedcdf7ac48ec5))
* **audio:** a device that stops calling is reported as a device loss ([c0aa7c5](https://github.com/Huckcity/cuerunner/commit/c0aa7c55b381154e41ef5b4031c60522a714aac6))
* **audio:** an event the consumer does not recognise is surfaced and counted ([d6d2679](https://github.com/Huckcity/cuerunner/commit/d6d26795ea918cf08fcf130383d3d6624a616c74))
* **audio:** configure with the settings already in force revives a dead backend ([14eefbc](https://github.com/Huckcity/cuerunner/commit/14eefbcbe848b370ce09e12c460bd19bafde186d))
* **audio:** place a boundary on the note ([8200f2e](https://github.com/Huckcity/cuerunner/commit/8200f2ef4ee5c1dd8feee5fdefa1ea224ef1bc06))
* **audio:** play a cue between the first and last audible samples ([ac0f03b](https://github.com/Huckcity/cuerunner/commit/ac0f03b4994abb5c108c6d6fdd8e89b7d1d7d345))
* **audio:** play through a native engine instead of the renderer ([5fa7112](https://github.com/Huckcity/cuerunner/commit/5fa711209abeb21070e9240c0c47ec69b00193a4))
* **audio:** split a cue, drag the boundary, and vamp it ([7175358](https://github.com/Huckcity/cuerunner/commit/717535825162522a46b0e574074713c9453bacab))
* **audio:** the trim's default, its cue row, and the panel that shows it ([526681c](https://github.com/Huckcity/cuerunner/commit/526681c35150ea67c4ec932333ffa3c88cf618da))
* **build:** the stated platforms and runtimes match what is built and tested ([696f4e5](https://github.com/Huckcity/cuerunner/commit/696f4e520de1d3547ec6fc871dde01391145877c))
* **bundle:** a show and its audio as one file ([26d7bf4](https://github.com/Huckcity/cuerunner/commit/26d7bf493b2685d83414adb8996637aa37a39686))
* **bundle:** a show too large to describe is refused, not written wrong ([3fdb12f](https://github.com/Huckcity/cuerunner/commit/3fdb12ffc6830fc526e895f35c1cafa8139f6f11))
* **changes:** the history and the comparison an operator can read ([7eefd64](https://github.com/Huckcity/cuerunner/commit/7eefd64ad44616ce237e92e66427b4f045ecce36))
* **cue-list:** the context menu takes the keyboard ([7c65146](https://github.com/Huckcity/cuerunner/commit/7c65146b3964456d75b08b046be3ea43c23af7a3))
* **cues:** batch colour across a multi-selection ([608d409](https://github.com/Huckcity/cuerunner/commit/608d40935226899be7afef0933517eaf616be09d))
* **cues:** durations exist as soon as a file does ([2b890ba](https://github.com/Huckcity/cuerunner/commit/2b890baa6bca8cb1d4d24b8941cd952ed8b65d46))
* **cues:** expand the top level, collapse everything ([c13634e](https://github.com/Huckcity/cuerunner/commit/c13634e9098bf634e297589bcd3b4c8d44662990))
* **desk:** a desk is told in its own arrangement, not the app's ([1b18e21](https://github.com/Huckcity/cuerunner/commit/1b18e2192c43523aed35a4203d69387be0e121ba))
* **desk:** run the show from the desk's own buttons ([042f26c](https://github.com/Huckcity/cuerunner/commit/042f26ca8a16308606ee022d98404b90f45e5bea))
* **dev:** npm run dev:pro starts the app with the Pro half unlocked ([588da06](https://github.com/Huckcity/cuerunner/commit/588da06f0792a8f922d77636185254c3ec2c8742))
* **dock:** the bottom of the window is one place, at one height ([e28c9bc](https://github.com/Huckcity/cuerunner/commit/e28c9bc2a025800560750445a582198357fdf04e))
* **docs:** every published number comes from a run ([28a0c46](https://github.com/Huckcity/cuerunner/commit/28a0c46e2a8a47abc1ffd556cef7ced4bfab2495))
* **docs:** the free-versus-Pro page states the line the code enforces ([99cb0f4](https://github.com/Huckcity/cuerunner/commit/99cb0f4037d672449093cf22fb9e899491fab919))
* **engine:** an ASIO backend, behind the same device interface ([d98ef40](https://github.com/Huckcity/cuerunner/commit/d98ef404c48c48241ded7f67e7e14ca1242c34c8))
* **engine:** block double triggers, and leave a running cue alone ([a9298ba](https://github.com/Huckcity/cuerunner/commit/a9298ba51a1ae665c006317797ac186a27c15c94))
* **engine:** scan a file for where its sound starts and stops ([914bb52](https://github.com/Huckcity/cuerunner/commit/914bb52bf73f86cc1a721de0a059f4a743c34acc))
* **inspector:** Basics shows what every cue shares, and nothing it does not use ([569fe6a](https://github.com/Huckcity/cuerunner/commit/569fe6acd0014b2190d2c4dc8dd222e9f617b38e))
* **integration:** a lane's claim is scoped to what that lane ran ([6684aef](https://github.com/Huckcity/cuerunner/commit/6684aef118ed03d9559775780fa5ffa166ee4dc1))
* **integration:** the three missing lanes are decided, built and recorded ([5fbe147](https://github.com/Huckcity/cuerunner/commit/5fbe1475cf906bd258dfcb366aec89dddf97eea4))
* **integration:** unproven is a status, and a skipped lane reports as skipped ([2dd2f98](https://github.com/Huckcity/cuerunner/commit/2dd2f98a961c919ed930a580d6e1adc759351bb7))
* **ipc:** a refusal is a value, and only a fault rejects ([fea7a6c](https://github.com/Huckcity/cuerunner/commit/fea7a6c326adff56fc3dec9cedcc569a2c4587ad))
* **licence:** the work since v0.13.0 is the half a key unlocks ([60eed4d](https://github.com/Huckcity/cuerunner/commit/60eed4dfb0a7b9cb55a5deca716189f40c7d19ca))
* **license:** each Pro feature is marked once, quietly, where it opens ([152c853](https://github.com/Huckcity/cuerunner/commit/152c8539c9a66a93cd5b54a87937c655aac6b870))
* **license:** entitlement is derived from the clock, not cached ([20097e9](https://github.com/Huckcity/cuerunner/commit/20097e9b903e4d7d070cadbb0de55e2fba6b936a))
* **license:** source-available, with the repo private from here ([cf768b8](https://github.com/Huckcity/cuerunner/commit/cf768b81b8f7e8320c61106abf5f386e79e722cb))
* **license:** the ears are free (F4) ([d5b94ec](https://github.com/Huckcity/cuerunner/commit/d5b94ec3688eda3ca2836b23707e097b8bedbaec))
* **license:** the ended key says what it leaves working, and the lane starts from a lapsed rental ([511b695](https://github.com/Huckcity/cuerunner/commit/511b695ef446aacaf9df1acaf70d2d10c50f3b9c))
* **license:** the issuer's rotation instruction is additive ([11af6a6](https://github.com/Huckcity/cuerunner/commit/11af6a638bd68f962b271e6aa5c14901bf5e24fd))
* **license:** the published classification matches the gate ([fd011be](https://github.com/Huckcity/cuerunner/commit/fd011be7858c0cd0d32854cc94d232d8c9ee77e6))
* **license:** the trim, the log filters and the show's history are free ([513fb90](https://github.com/Huckcity/cuerunner/commit/513fb902482cfe87388e727cea7dc4ca2c8e7b46))
* **log:** a line that happened twice in a row is said once, with the count ([07ba18b](https://github.com/Huckcity/cuerunner/commit/07ba18bff575e3d47bd3d4905efe063bd4059d63))
* **matrix:** the view the show is run from, with a lock ([3fa83f2](https://github.com/Huckcity/cuerunner/commit/3fa83f2e5296e3a27898846d614058d60140f505))
* **menu:** one File menu, in the menu bar and behind the WinsLab button ([b5f480c](https://github.com/Huckcity/cuerunner/commit/b5f480c15ae89696b354797157ea7ee6cd5924fe))
* **merge:** two people's work, merged into a third file ([0de1251](https://github.com/Huckcity/cuerunner/commit/0de1251f62b9e951db92f4258d0206dc7ad45552))
* **midi:** drive a desk over its own MIDI socket ([e125f0e](https://github.com/Huckcity/cuerunner/commit/e125f0ee0d11dbbff29893eb99e32e605442e3a6))
* **playback:** move the desk onto the native engine ([b572dcc](https://github.com/Huckcity/cuerunner/commit/b572dcc1c1394f93f05d17c341b8fc820a1a966d))
* **recovery:** hand back the cue the session was standing on ([30288df](https://github.com/Huckcity/cuerunner/commit/30288df22ffa328ed1cd391951631cda8eca5266))
* **redundancy:** a machine that stands by, listens and takes the show ([a872cba](https://github.com/Huckcity/cuerunner/commit/a872cba1867e055f20c44d7a93a14af084311d7c))
* **redundancy:** picking a show up where the live machine left it ([c3cdbf1](https://github.com/Huckcity/cuerunner/commit/c3cdbf174cdefe9fdb05d73b60047d408d1fb510))
* **redundancy:** the protocol and the decisions a pair of machines share ([9b4c4fa](https://github.com/Huckcity/cuerunner/commit/9b4c4fa3aed166fe4eb6d38b7976895c98b938dd))
* **redundancy:** the tab an operator sets a pair up from, and the status they run it on ([c8109dc](https://github.com/Huckcity/cuerunner/commit/c8109dcee7930bb1bdd34ad8c3554c9d28566b4e))
* **release:** v0.14.0 is dispatched, signed and published ([cbebc5a](https://github.com/Huckcity/cuerunner/commit/cbebc5a9eac59480484149e80651203914149b53))
* **safety:** the device going away mid-show is a case the suite covers ([cef388b](https://github.com/Huckcity/cuerunner/commit/cef388b9ae910273ed457afe800c7e323ea1824e))
* **save:** a save checks the file it is about to replace ([78bfc75](https://github.com/Huckcity/cuerunner/commit/78bfc75ed5d8ad44db8a8f182dfb79a573fc525c))
* **save:** the save witnesses every section the show can change ([1ee363b](https://github.com/Huckcity/cuerunner/commit/1ee363bae7f85ffece476ea7d5162f6569a259fa))
* **scenes:** less to read, an undo, and a view that stays put while you edit ([61d848b](https://github.com/Huckcity/cuerunner/commit/61d848be1bed4568a2730fd97e65d2b0d2dd16b4))
* **scenes:** scenes that drive the desk's mutes ([34cef0d](https://github.com/Huckcity/cuerunner/commit/34cef0d020e30b73482cc50b12dd6c44b6008f0c))
* **scenes:** the view follows the show, and the header names what is next ([8898331](https://github.com/Huckcity/cuerunner/commit/88983311979d0757833c5f4e77fec884d514a0b7))
* **scenes:** the view opens to run the show, and Edit is a press made on purpose ([fc95134](https://github.com/Huckcity/cuerunner/commit/fc95134d696d5752cd20c74d70a2e86ded303abd))
* **settings:** exclusive mode is a device setting, with the engine's own answer ([1ebda57](https://github.com/Huckcity/cuerunner/commit/1ebda57c83db987ebad693a24d4e9f91f3171d8a))
* **settings:** say why a show service is not listening ([a39b1ad](https://github.com/Huckcity/cuerunner/commit/a39b1ad7f6e84aff154b7a58d723789e2816e818))
* **settings:** sections down the side, one shape per service, protocol behind Advanced ([dfe7e08](https://github.com/Huckcity/cuerunner/commit/dfe7e0872f46f935fc0943eb379d9b17eb236004))
* **settings:** tabs by what is being set up, and hints a line long ([4880e23](https://github.com/Huckcity/cuerunner/commit/4880e23b415b9076e3a5b070126418003b9895e0))
* **settings:** the audio system is a setting, not a build-time choice ([dd576e3](https://github.com/Huckcity/cuerunner/commit/dd576e3489fd9e1bb2cd2ccbf5a6f86fa972e258))
* **show control:** a cue that tells another console to go, and hears it when it does ([d9a4d93](https://github.com/Huckcity/cuerunner/commit/d9a4d93188b83fdd2a8095815652419db7968647))
* **show:** a configure restarts exactly the services whose values really changed ([1fd83ac](https://github.com/Huckcity/cuerunner/commit/1fd83ac55892eac293a447ce041c27e2474bccf5))
* **show:** device services, a live monitor, and the wireless panel ([a4cddad](https://github.com/Huckcity/cuerunner/commit/a4cddad9942c006078e67bcfa984e637af4ceb0a))
* **show:** each service declares the settings sections it reads ([3fd29b5](https://github.com/Huckcity/cuerunner/commit/3fd29b559f84435416dfb337cbb1e4546bdbc58d))
* **showfile:** edits and measurements are told apart per cue type and field ([dc187ac](https://github.com/Huckcity/cuerunner/commit/dc187acfd9a63421cac77172ab9926288e16d734))
* **showfile:** every writer of a saved artifact is enumerated with its declared behaviour ([82c5dc6](https://github.com/Huckcity/cuerunner/commit/82c5dc60e933013dec7e885ac89a48413730b4b1))
* **showfile:** the file remembers what each save changed ([f7621c3](https://github.com/Huckcity/cuerunner/commit/f7621c3b63d0401b3c1c13cd6b09ac1079d497d4))
* **show:** the script panel, and a tablet companion for it ([172a789](https://github.com/Huckcity/cuerunner/commit/172a7895ee521028684c52398bdab69457e91adc))
* **show:** triggers, and a presence service for the show network ([9655613](https://github.com/Huckcity/cuerunner/commit/96556138c34265a9b9c9082ec1ad2417779befae))
* **site:** a Free and Pro page, and a shop front that says what it sells ([089abae](https://github.com/Huckcity/cuerunner/commit/089abaee63d5573e53dd4a27bbd3a366b6bb061d))
* **site:** reliability is a page, and its numbers come from the nightly ([de293e7](https://github.com/Huckcity/cuerunner/commit/de293e7208c3514839ba7bbaef83395497aeb3e2))
* **site:** the key runbook, the boundary page, and a format marker that missed the rename ([2259754](https://github.com/Huckcity/cuerunner/commit/22597547f7841612fac792049794b42c8f0f5a1b))
* **standby:** one line says what GO fires, and what is left of what is running ([a853f57](https://github.com/Huckcity/cuerunner/commit/a853f57c82c3ded812e019bba32d123724396f70))
* **transport:** a standing alarm is on screen whatever panel is open ([8b76144](https://github.com/Huckcity/cuerunner/commit/8b761445d6c10e9a8317881715c9f20abd6c708d))
* **ui:** a field tells you it saved ([2e6e4b9](https://github.com/Huckcity/cuerunner/commit/2e6e4b964e7d50fdac64ba0bf492bc342385a534))
* **ui:** four readable text tones, one type scale, and icons the app draws itself ([45ca349](https://github.com/Huckcity/cuerunner/commit/45ca349ac56afbf219f881c760149208a711003b)), closes [#666](https://github.com/Huckcity/cuerunner/issues/666) [#555](https://github.com/Huckcity/cuerunner/issues/555)
* **ui:** hints that fit on a line, and reference where reference belongs ([459eafa](https://github.com/Huckcity/cuerunner/commit/459eafab40b0a1080216845e7a7f1c291ceb0c9a))
* **ui:** live and next side by side, two presses in the transport, one form grid ([e2e4cc5](https://github.com/Huckcity/cuerunner/commit/e2e4cc593a61a230e00fa1fe8939dc8d5b291cc7))
* **wave3:** adoption and classification are recorded before anything is built ([fea4b62](https://github.com/Huckcity/cuerunner/commit/fea4b62020f128aabf5b430f8bcfcbfc33cc00cf))
* **waveform:** read the part of the file the operator is looking at ([69b5e91](https://github.com/Huckcity/cuerunner/commit/69b5e9157743e994ece848fff16fb9eed1f7c9d5))
* **waveform:** the panel zooms, and the cursor belongs to its cue ([921ddc6](https://github.com/Huckcity/cuerunner/commit/921ddc6df0c6a22d720559eeadc3130bd9cc83e3))
* **website:** a buyer starts a trial and finds support without asking anyone ([4f3fabd](https://github.com/Huckcity/cuerunner/commit/4f3fabd3f43221147f8d1f3954f62099e71e8e7f))
* **website:** each SKU buys through its own Stripe link ([bcc2d59](https://github.com/Huckcity/cuerunner/commit/bcc2d59370476e37aade053fa592c6a4eff8c643))
* **website:** the licence row buys by card at the Stripe link ([5b6cca8](https://github.com/Huckcity/cuerunner/commit/5b6cca8c131590c976c3cab38cfbe52d2a024a75))
* **website:** the price page states the model and the routes that buy it ([2af0be1](https://github.com/Huckcity/cuerunner/commit/2af0be178713989efc8c713ba14fdd732cf1e457))
* **website:** the purchase-order route answers at orders@cuerunner.app ([e587b45](https://github.com/Huckcity/cuerunner/commit/e587b45d1b3caebc8072caca492882d5809a2620))
* **wireless:** a mic plot you can enter, swaps, and a report ([152b1cc](https://github.com/Huckcity/cuerunner/commit/152b1cc6d794f96582b81ce8f4d55949a6b79934))
* **workspace:** broken grouping is repaired on load, and the operator is told ([f070afe](https://github.com/Huckcity/cuerunner/commit/f070afe3e819b85535b4da14cc8167f839e46db0))

# [0.13.0](https://github.com/Huckcity/winslab/compare/v0.12.0...v0.13.0) (2026-09-11)


### Bug Fixes

* **inspector:** move the loop-count hint under its field ([b4d7dd5](https://github.com/Huckcity/winslab/commit/b4d7dd576bbb2ac7ccb6d48c415f51045ea5a1d5))


### Features

* **inspector:** reset any cue field to its new-cue default ([b1fdf3a](https://github.com/Huckcity/winslab/commit/b1fdf3a58dbc453df895e343f65ca97358b15abe))

# [0.12.0](https://github.com/Huckcity/winslab/compare/v0.11.0...v0.12.0) (2026-09-11)


### Bug Fixes

* **engine:** let a stop cue take a script run away ([9316e64](https://github.com/Huckcity/winslab/commit/9316e64b03a4085b53bf05b2b0b03f7822487364))
* **engine:** stop a group with its children ([6fa9d7a](https://github.com/Huckcity/winslab/commit/6fa9d7ae83f7cbacac40c287ab9c5f8e2e1b3015))
* **inspector:** close the decoding context when a file will not decode ([b9fc854](https://github.com/Huckcity/winslab/commit/b9fc8540277dc4a122237955abc1d1481e0aa4a2))
* **osc:** keep one socket per destination instead of one per send ([951a200](https://github.com/Huckcity/winslab/commit/951a20015722075cb97269c6416a86ee88757f03))


### Features

* **script:** give include() module semantics ([9036a3f](https://github.com/Huckcity/winslab/commit/9036a3f1bd0306bdaa75c53c80653557013168b0))

# [0.11.0](https://github.com/Huckcity/winslab/compare/v0.10.0...v0.11.0) (2026-09-11)


### Bug Fixes

* **engine:** abandon in-flight work on STOP and fade audio on PANIC ([d7ad968](https://github.com/Huckcity/winslab/commit/d7ad968715669e5168a50c49240e8edcec0bf99f))
* save durably, offer unsaved work back, and make typecheck check ([31b2fb0](https://github.com/Huckcity/winslab/commit/31b2fb0238f5f1cecdd1cf2bff0d199123ddc566))


### Features

* **engine:** report what audio, MIDI and OSC cues actually did ([ea98ab8](https://github.com/Huckcity/winslab/commit/ea98ab81319658545351d2b93e5bf59525a3dba7))
* **script:** run script cues in a worker with a timeout ([0b4bdbf](https://github.com/Huckcity/winslab/commit/0b4bdbf34d414abc650783ecc62f82541a6f714f))
* survive renderer and main-process failures ([9dee15b](https://github.com/Huckcity/winslab/commit/9dee15b42999d78f2522c0f0f372167483bee17a))


### Performance Improvements

* bound decoded audio by bytes and draw waveforms from an envelope ([3439e8f](https://github.com/Huckcity/winslab/commit/3439e8f7e38877c9c758d8f9a7c1f633249360ee))

# [0.10.0](https://github.com/Huckcity/winslab/compare/v0.9.0...v0.10.0) (2026-09-10)


### Features

* **demo:** ship a demo workspace new users can open in one click ([9d00cc1](https://github.com/Huckcity/winslab/commit/9d00cc18616d8d7d7bfa6301a7f2fbf13c63cab1))

# [0.9.0](https://github.com/Huckcity/winslab/compare/v0.8.0...v0.9.0) (2026-09-10)


### Features

* **timeline:** snap dragged blocks to the edges of the other blocks ([#62](https://github.com/Huckcity/winslab/issues/62)) ([e08da9f](https://github.com/Huckcity/winslab/commit/e08da9fcd90042ef935a2b493f6e73e81ad0ff5b))

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
