# Third-Party Notices

This project incorporates substantial code, CSS recipes, visual styles, and font assets from upstream projects under their respective open-source licenses.

---

## 1. herdr-web-ui (Visual UI & Style Adaptation)

Visual design, CSS recipes, tokens, layout rhythms, and presentation assets adapted from:

- **Repository:** https://github.com/devswha/herdr-web-ui
- **Pinned Commit:** `b498e7f053de3ac30318ac7d88b6fd21865edadf`
- **Copyright:** (c) 2026 devswha
- **License:** MIT License

```
MIT License

Copyright (c) 2026 devswha

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Turn edit links and long-message folding (October 14, 2026)

Adapted from `devswha/herdr-web-ui` at
`dc2f11de3069fe22cd7d1086c077cdc37ffd8a18` (MIT, copyright 2026 devswha):
`src/lib/turnChangedFiles.ts`, its tests, the exact edit/write name table from
`toolVerbs.ts`, file-path grammar from `shared/patch.ts`, `TurnChangedFiles.tsx`,
`src/lib/userMessageFold.ts` and tests, ChatView UserMessage/CSS anatomy,
and the IME-aware Enter-commit behavior of SettingsDialog.FontFamilyInput.
Local consumers are `src/utils/turn-changed-files.ts`, `user-message-fold.ts`,
their focused tests, `src/components/turn-changed-files.tsx`, ChatView and ChatFiles.
The fold rule derives from T3 Code's `MessagesTimeline.logic.ts`
`shouldCollapseUserMessage` (MIT, copyright 2026 T3 Tools Inc.; notice below).
No upstream machine/directory authority, narrated shell edit inference, minimap,
virtualization or global keyboard owner is copied. Existing local repository
listing freshness and contextual file access remain the authority.

## Composer context, inert drafts and terminal quotes (October 14, 2026)

Adapted from `devswha/herdr-web-ui` at
`dc2f11de3069fe22cd7d1086c077cdc37ffd8a18` (MIT, copyright 2026 devswha):
`composerStrip.ts`, `paneBranch.ts`, `composerDraft.ts`, `terminalQuote.ts`,
their tests, and Composer/PaneTerminal integration anatomy. Local owners are
`src/utils/composer-strip.ts`, `composer-draft.ts`, `terminal-quote.ts`, their
focused tests, and App/PromptComposer/TerminalCanvas consumers. The context-strip
anatomy references T3 Code (MIT, copyright 2026 T3 Tools Inc.; notice above).
No upstream send lease, prefix acknowledgment, auto-send or Git inventory reader
is adopted. Workspace checkout facts remain explicitly Space-scoped, not an
assertion about a pane's potentially different cwd.

## Chat search and reading-position adaptation (October 14, 2026)

Behavioral logic adapted from `devswha/herdr-web-ui` at
`dc2f11de3069fe22cd7d1086c077cdc37ffd8a18`, under the MIT License printed above
(Copyright (c) 2026 devswha):

- `src/utils/chat-search.ts` and its tests <- `src/lib/chatSearch.ts` and tests
- `src/components/chat-find.tsx` <- `src/components/ChatFind.tsx`
- `src/utils/chat-scroll-memory.ts` and its tests, reading-position/Find integration
  in `src/components/chat-view.tsx` <- `src/lib/chatScrollMemory.ts` and tests,
  `src/components/ChatView.tsx`

The upstream scroll-memory and ChatView logic in turn adapts T3 Code
(`pingdotgg/t3code`, revision `e82a1ce3f369f113b0b33dff8249569c345e30e8`),
`apps/web/src/components/chat/timelineScrollAnchoring.ts` and
`apps/web/src/components/chat/MessagesTimeline.tsx`, under the same MIT License
printed above, with this copyright notice:

```
Copyright (c) 2026 T3 Tools Inc.
```

Local adaptations use native stable turn IDs, exact pane/terminal/session/source/history
identity, existing cancellable HTTP reads and canonical Base UI controls. Upstream
Legend List virtualization was evaluated but is not bundled or adapted. This does
not change the earlier visual/source pin or current palette ownership.

---

## Repository Changes adaptation (October 14, 2026)

Behavioral logic adapted from `devswha/herdr-web-ui` at
`dc2f11de3069fe22cd7d1086c077cdc37ffd8a18` under the MIT License printed above,
Copyright (c) 2026 devswha:

- `server/repo-diff.ts` and synthetic tests <- `server/repo-diff.ts` and tests
  (NUL listing/count parsing, comparison, Git argv and bounded output/process logic)
- `src/types/repo-diff.ts` <- browser-safe repository diff DTOs in `shared/protocol.ts`
- `src/utils/change-tree.ts` and tests <- `src/lib/changeTree.ts` and tests
- `src/components/repo-changes.tsx` and `repo-changes.css` <- `RepoChanges.tsx` /
  `RepoChanges.css`, `RepoDiffViewer.tsx` / `RepoDiffViewer.css`, `FilesDialog.css`
  and shared segmented/icon controls in `src/styles.css` (comparison toolbar,
  repository strip, folder/file rows, status chips, counts, skeletons and patch header)
- `src/components/repo-change-presentation.tsx` <- `FileGlyph.tsx`, `src/lib/fileIcons.ts`,
  `pathParts` in `src/lib/filePaths.ts`, status vocabulary in `src/lib/repoDiff.ts`
  and `src/lib/skeleton.ts` (complete file-kind Lucide mapping and loading row widths)

The upstream folder tree/Changes and diff-viewer jobs adapt T3 Code at the revision
and copyright printed in the preceding section, specifically
`apps/web/src/components/diffs/diffFileTree.logic.ts`, `DiffFileTree.tsx`,
`apps/web/src/components/DiffFilePathCopyButton.tsx` and `DiffPanelShell.tsx`.
Local auth, snapshot binding, Git environment/filter isolation and descriptor-only
untracked reads replace upstream transport/raw pathname assumptions. Current dark
recipes remain local. `src/components/repo-diff.tsx`, `diff-worker-pool.tsx`,
`repo-diff-boundary.tsx`, `src/utils/repo-diff-view.ts`, `repo-diff-style.ts` and
`idle-lease.ts` adapt upstream `RepoDiff.tsx`, `DiffWorkerPool.tsx`, `RenderBoundary.tsx`,
`sourceTheme.ts`, `repoDiff.ts` and `idleLease.ts`. The upstream shared pool/idle
lifetime also adapts T3 Code `apps/web/src/components/DiffWorkerPoolProvider.tsx`.
Exact `@pierre/diffs` 1.5.2 is bundled under the Apache-2.0 notices below.

---

## Pierre diffs

Repository patches use `@pierre/diffs` 1.5.2, with its parser, React virtualizer and
shared two-worker pool. Main installed the exact dependency; the bundled
`@pierre/theme` 2.0.0 and `@pierre/theming` 1.0.1 are also Apache-2.0.
The license and notices below are copied verbatim from the pinned upstream notice
collection and match the installed package versions. Local theme/layout code is
adapted to Herdr Web's existing dark tokens; no upstream light palette is adopted.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction, and
    distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by the
    copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all other
    entities that control, are controlled by, or are under common control with
    that entity. For the purposes of this definition, "control" means (i) the
    power, direct or indirect, to cause the direction or management of such
    entity, whether by contract or otherwise, or (ii) ownership of fifty percent
    (50%) or more of the outstanding shares, or (iii) beneficial ownership of
    such entity.

    "You" (or "Your") shall mean an individual or Legal Entity exercising
    permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation source, and
    configuration files.

    "Object" form shall mean any form resulting from mechanical transformation
    or translation of a Source form, including but not limited to compiled
    object code, generated documentation, and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or Object form,
    made available under the License, as indicated by a copyright notice that is
    included in or attached to the work (an example is provided in the Appendix
    below).

    "Derivative Works" shall mean any work, whether in Source or Object form,
    that is based on (or derived from) the Work and for which the editorial
    revisions, annotations, elaborations, or other modifications represent, as a
    whole, an original work of authorship. For the purposes of this License,
    Derivative Works shall not include works that remain separable from, or
    merely link (or bind by name) to the interfaces of, the Work and Derivative
    Works thereof.

    "Contribution" shall mean any work of authorship, including the original
    version of the Work and any modifications or additions to that Work or
    Derivative Works thereof, that is intentionally submitted to Licensor for
    inclusion in the Work by the copyright owner or by an individual or Legal
    Entity authorized to submit on behalf of the copyright owner. For the
    purposes of this definition, "submitted" means any form of electronic,
    verbal, or written communication sent to the Licensor or its
    representatives, including but not limited to communication on electronic
    mailing lists, source code control systems, and issue tracking systems that
    are managed by, or on behalf of, the Licensor for the purpose of discussing
    and improving the Work, but excluding communication that is conspicuously
    marked or otherwise designated in writing by the copyright owner as "Not a
    Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity on
    behalf of whom a Contribution has been received by Licensor and subsequently
    incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable copyright license to
    reproduce, prepare Derivative Works of, publicly display, publicly perform,
    sublicense, and distribute the Work and such Derivative Works in Source or
    Object form.

3.  Grant of Patent License. Subject to the terms and conditions of this
    License, each Contributor hereby grants to You a perpetual, worldwide,
    non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
    this section) patent license to make, have made, use, offer to sell, sell,
    import, and otherwise transfer the Work, where such license applies only to
    those patent claims licensable by such Contributor that are necessarily
    infringed by their Contribution(s) alone or by combination of their
    Contribution(s) with the Work to which such Contribution(s) was submitted.
    If You institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work or a
    Contribution incorporated within the Work constitutes direct or contributory
    patent infringement, then any patent licenses granted to You under this
    License for that Work shall terminate as of the date such litigation is
    filed.

4.  Redistribution. You may reproduce and distribute copies of the Work or
    Derivative Works thereof in any medium, with or without modifications, and
    in Source or Object form, provided that You meet the following conditions:

    (a) You must give any other recipients of the Work or Derivative Works a
    copy of this License; and

    (b) You must cause any modified files to carry prominent notices stating
    that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works that You
    distribute, all copyright, patent, trademark, and attribution notices from
    the Source form of the Work, excluding those notices that do not pertain to
    any part of the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its distribution,
    then any Derivative Works that You distribute must include a readable copy
    of the attribution notices contained within such NOTICE file, excluding
    those notices that do not pertain to any part of the Derivative Works, in at
    least one of the following places: within a NOTICE text file distributed as
    part of the Derivative Works; within the Source form or documentation, if
    provided along with the Derivative Works; or, within a display generated by
    the Derivative Works, if and wherever such third-party notices normally
    appear. The contents of the NOTICE file are for informational purposes only
    and do not modify the License. You may add Your own attribution notices
    within Derivative Works that You distribute, alongside or as an addendum to
    the NOTICE text from the Work, provided that such additional attribution
    notices cannot be construed as modifying the License.

    You may add Your own copyright statement to Your modifications and may
    provide additional or different license terms and conditions for use,
    reproduction, or distribution of Your modifications, or for any such
    Derivative Works as a whole, provided Your use, reproduction, and
    distribution of the Work otherwise complies with the conditions stated in
    this License.

5.  Submission of Contributions. Unless You explicitly state otherwise, any
    Contribution intentionally submitted for inclusion in the Work by You to the
    Licensor shall be under the terms and conditions of this License, without
    any additional terms or conditions. Notwithstanding the above, nothing
    herein shall supersede or modify the terms of any separate license agreement
    you may have executed with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade names,
    trademarks, service marks, or product names of the Licensor, except as
    required for reasonable and customary use in describing the origin of the
    Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or agreed to in
    writing, Licensor provides the Work (and each Contributor provides its
    Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied, including, without limitation, any
    warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
    FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining
    the appropriateness of using or redistributing the Work and assume any risks
    associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory, whether in
    tort (including negligence), contract, or otherwise, unless required by
    applicable law (such as deliberate and grossly negligent acts) or agreed to
    in writing, shall any Contributor be liable to You for damages, including
    any direct, indirect, special, incidental, or consequential damages of any
    character arising as a result of this License or out of the use or inability
    to use the Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all other
    commercial damages or losses), even if such Contributor has been advised of
    the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing the Work or
    Derivative Works thereof, You may choose to offer, and charge a fee for,
    acceptance of support, warranty, indemnity, or other liability obligations
    and/or rights consistent with this License. However, in accepting such
    obligations, You may act only on Your own behalf and on Your sole
    responsibility, not on behalf of any other Contributor, and only if You
    agree to indemnify, defend, and hold each Contributor harmless for any
    liability incurred by, or claims asserted against, such Contributor by
    reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2025 Pierre Computer Company

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
```

`@pierre/theme` also ships this notice, for the theme it was built on:

````
This theme was built on top of
[GitHub's Visual Studio Code Theme](https://github.com/primer/github-vscode-theme),
reusing its technique and build tooling, which we have since iterated on for
more specific language tokens.

`@pierre/theme` is licensed under Apache-2.0 (see `LICENSE`). The original MIT
license for `primer/github-vscode-theme` is included below for attribution.

Original license for `primer/github-vscode-theme`:

```
MIT License

Copyright (c) 2020 Primer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
````

### Pierre's bundled dependencies

The installed dependency versions match the following pinned upstream inventory.
Each license text follows once under the packages that share it, with every
copyright line the packages ship.

| Package | Upstream | Version | License |
|---|---|---|---|
| shiki, @shikijs/core, @shikijs/engine-javascript, @shikijs/engine-oniguruma, @shikijs/langs, @shikijs/primitive, @shikijs/themes, @shikijs/transformers, @shikijs/types | https://github.com/shikijs/shiki | 4.5.0 | MIT |
| @shikijs/vscode-textmate | https://github.com/shikijs/vscode-textmate | 10.0.2 | MIT |
| diff (jsdiff) | https://github.com/kpdecker/jsdiff | 9.0.0 | BSD 3-Clause |
| lru_map | https://github.com/rsms/js-lru | 0.4.1 | MIT |
| @ungap/structured-clone | https://github.com/ungap/structured-clone | 1.4.0 | ISC |
| dequal | https://github.com/lukeed/dequal | 2.0.3 | MIT |
| oniguruma-to-es | https://github.com/slevithan/oniguruma-to-es | 4.3.6 | MIT |
| oniguruma-parser | https://github.com/slevithan/oniguruma-parser | 0.12.2 | MIT |
| regex | https://github.com/slevithan/regex | 6.1.0 | MIT |
| regex-recursion | https://github.com/slevithan/regex-recursion | 6.0.2 | MIT |
| regex-utilities | https://github.com/slevithan/regex-utilities | 2.3.0 | MIT |
| hast-util-to-html | https://github.com/syntax-tree/hast-util-to-html | 9.0.5 | MIT |
| hast-util-whitespace | https://github.com/syntax-tree/hast-util-whitespace | 3.0.0 | MIT |
| mdast-util-to-hast | https://github.com/syntax-tree/mdast-util-to-hast | 13.2.1 | MIT |
| unist-util-is | https://github.com/syntax-tree/unist-util-is | 6.0.1 | MIT |
| unist-util-position | https://github.com/syntax-tree/unist-util-position | 5.0.0 | MIT |
| unist-util-stringify-position | https://github.com/syntax-tree/unist-util-stringify-position | 4.0.0 | MIT |
| unist-util-visit | https://github.com/syntax-tree/unist-util-visit | 5.1.0 | MIT |
| unist-util-visit-parents | https://github.com/syntax-tree/unist-util-visit-parents | 6.0.2 | MIT |
| vfile | https://github.com/vfile/vfile | 6.0.3 | MIT |
| vfile-message | https://github.com/vfile/vfile-message | 4.0.3 | MIT |
| micromark-util-character, micromark-util-encode, micromark-util-sanitize-uri, micromark-util-symbol, micromark-util-types | https://github.com/micromark/micromark | 2.1.1, 2.0.1, 2.0.1, 2.0.1, 2.0.3 | MIT |
| ccount | https://github.com/wooorm/ccount | 2.0.1 | MIT |
| character-entities-html4 | https://github.com/wooorm/character-entities-html4 | 2.1.0 | MIT |
| character-entities-legacy | https://github.com/wooorm/character-entities-legacy | 3.0.0 | MIT |
| comma-separated-tokens | https://github.com/wooorm/comma-separated-tokens | 2.0.3 | MIT |
| devlop | https://github.com/wooorm/devlop | 1.1.0 | MIT |
| html-void-elements | https://github.com/wooorm/html-void-elements | 3.0.0 | MIT |
| property-information | https://github.com/wooorm/property-information | 7.2.0 | MIT |
| space-separated-tokens | https://github.com/wooorm/space-separated-tokens | 2.0.2 | MIT |
| stringify-entities | https://github.com/wooorm/stringify-entities | 4.0.4 | MIT |
| trim-lines | https://github.com/wooorm/trim-lines | 3.0.1 | MIT |
| zwitch | https://github.com/wooorm/zwitch | 2.0.4 | MIT |

#### Shiki 4.5.0: shiki, @shikijs/core, @shikijs/engine-javascript, @shikijs/engine-oniguruma, @shikijs/langs, @shikijs/primitive, @shikijs/themes, @shikijs/transformers, @shikijs/types

```
MIT License

Copyright (c) 2021 Pine Wu
Copyright (c) 2023 Anthony Fu <https://github.com/antfu>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### @shikijs/vscode-textmate 10.0.2

```
The MIT License (MIT)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### diff 9.0.0 (jsdiff)

```
BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### lru_map 0.4.1

The package ships its license in its README:

```
Copyright (c) 2010-2016 Rasmus Andersson <https://rsms.me/>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### @ungap/structured-clone 1.4.0

```
ISC License

Copyright (c) 2021, Andrea Giammarchi, @WebReflection

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE
OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

#### dequal 2.0.3

```
The MIT License (MIT)

Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### Steven Levithan's regex packages

The MIT text below is shipped by each with its own copyright line:

- oniguruma-to-es 4.3.6: `Copyright (c) 2024-2026 Steven Levithan`
- oniguruma-parser 0.12.2: `Copyright (c) 2025-2026 Steven Levithan`
- regex 6.1.0, regex-recursion 6.0.2: `Copyright (c) 2025 Steven Levithan`
- regex-utilities 2.3.0: `Copyright (c) 2024 Steven Levithan`

```
MIT License

Copyright (c) 2025 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### Titus Wormer's unified and micromark packages

The MIT text below is shipped by each with its own copyright line:

- hast-util-to-html 9.0.5, micromark-util-character 2.1.1, micromark-util-encode 2.0.1, micromark-util-sanitize-uri 2.0.1, micromark-util-symbol 2.0.1, micromark-util-types 2.0.3, vfile-message 4.0.3: `Copyright (c) Titus Wormer <tituswormer@gmail.com>`
- ccount 2.0.1, character-entities-html4 2.1.0, character-entities-legacy 3.0.0, unist-util-is 6.0.1, unist-util-position 5.0.0, unist-util-visit 5.1.0, vfile 6.0.3: `Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com>`
- stringify-entities 4.0.4, trim-lines 3.0.1: `Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com>`
- comma-separated-tokens 2.0.3, hast-util-whitespace 3.0.0, html-void-elements 3.0.0, mdast-util-to-hast 13.2.1, space-separated-tokens 2.0.2, unist-util-stringify-position 4.0.0, unist-util-visit-parents 6.0.2, zwitch 2.0.4: `Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>`
- devlop 1.1.0: `Copyright (c) 2023 Titus Wormer <tituswormer@gmail.com>`
- property-information 7.2.0: `Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com>`

```
(The MIT License)

Copyright (c) Titus Wormer <tituswormer@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 2. Bundled Typefaces

The font assets bundled in `src/fonts/` originate from `devswha/herdr-web-ui` and are licensed under the following terms:

### Pretendard Variable

- **Upstream:** https://github.com/orioncactus/pretendard
- **Files:** `src/fonts/pretendard/*`
- **License:** SIL Open Font License 1.1

```
Copyright (c) 2021 Kil Hyung-jin (orioncactus@gmail.com),
with Reserved Font Name 'Pretendard'.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless prominent written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the
Font Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license and not under any
other license. The requirement for fonts to remain under this license
does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### JetBrains Mono

- **Upstream:** https://github.com/JetBrains/JetBrainsMono
- **Files:** `src/fonts/JetBrainsMono-Regular.woff2`
- **License:** SIL Open Font License 1.1
- **Copyright:** Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

### Symbols Nerd Font Mono (Nerd Fonts Symbols Only)

- **Upstream:** https://github.com/ryanoasis/nerd-fonts
- **Files:** `src/fonts/SymbolsNerdFontMono-Regular.woff2`
- **Version:** v3.5.1 (`NerdFontsSymbolsOnly.zip`), converted to WOFF2
- **License:** MIT License (with bundled glyph sets under SIL OFL 1.1, Apache 2.0, and CC BY 4.0 as documented in upstream Nerd Fonts)
