import { describe, expect, it, mock } from 'bun:test'
import {
  isImageExtension,
  isImageUrl,
  cleanCandidatePath,
  processBufferLine,
  findImageCandidatesInWindow,
  createTerminalImageLinkProvider,
  type IBufferLineLike,
  type IBufferCellLike
} from '../utils/terminal-image-links.ts'

describe('terminal-image-links', () => {
  const linksForRows = (rows: string[], query: number) => {
    const lines = rows.map((text) => ({
      length: 100,
      isWrapped: false,
      translateToString: () => text.padEnd(100, ' ')
    }))
    const onActivate = mock()
    const provider = createTerminalImageLinkProvider({
      isControlMode: () => false,
      getBufferLine: (index) => lines[index],
      onActivate
    })
    let found: string[] = []
    provider.provideLinks(query, (links) => {
      found = links?.map((link) => link.text) ?? []
      for (const link of links ?? []) {
        link.activate({ button: 0 } as MouseEvent, link.text)
      }
    })
    return { found, onActivate }
  }

  it('resolves the screenshot View Image alignment on both rows', () => {
    const rows = [
      '• View Image .agent-state/qa/image-preview-637/wr',
      '             ap-mobile-open.png'
    ]
    for (const query of [1, 2]) {
      const { found, onActivate } = linksForRows(rows, query)
      expect(found).toEqual([
        '.agent-state/qa/image-preview-637/wrap-mobile-open.png'
      ])
      expect(onActivate.mock.calls[0]?.[0]).toBe(found[0])
    }
  })

  it('keeps View Image alignment across multiple indented continuations', () => {
    const rows = [
      '• View Image .agent-state/qa/',
      '             image-preview-637/',
      '             wrap-mobile-',
      '             open.png'
    ]
    for (const query of [1, 2, 3, 4]) {
      expect(linksForRows(rows, query).found).toEqual([
        '.agent-state/qa/image-preview-637/wrap-mobile-open.png'
      ])
    }
  })

  it('does not join ordinary prose, misalignment or new image records', () => {
    for (const rows of [
      ['Description .agent-state/qa/wr', '             ap.png'],
      ['• View Image .agent-state/qa/wr', '     ap.png'],
      ['• View Image .agent-state/qa/wr', '             ./other.png'],
      ['• View Image .agent-state/qa/wr', '             Read 1 image'],
      ['• View Image .agent-state/qa/wr', '• View Image ./other.png']
    ]) {
      expect(linksForRows(rows, 1).found).toEqual([])
      expect(linksForRows(rows, 2).found).not.toContain(
        '.agent-state/qa/wrap.png'
      )
    }
    const completed = [
      '• View Image .agent-state/qa/first.png',
      '             second.png'
    ]
    expect(linksForRows(completed, 1).found).toEqual([
      '.agent-state/qa/first.png'
    ])
    expect(linksForRows(completed, 2).found).toEqual(['second.png'])
  })

  it('retains tool alignment after an intervening native physical wrap', () => {
    const header = '• View Image .agent-state/qa/image-preview-637/wr'
    const rows = [
      header.slice(0, 35),
      header.slice(35),
      '             ap-mobile-open.png'
    ]
    const lines = rows.map((text) => ({
      length: 35,
      isWrapped: false,
      translateToString: () => text.padEnd(35, ' ')
    }))
    const provider = createTerminalImageLinkProvider({
      isControlMode: () => false,
      getBufferLine: (index) => lines[index],
      onActivate: () => {}
    })
    provider.provideLinks(3, (links) => {
      expect(links?.map((link) => link.text)).toEqual([
        '.agent-state/qa/image-preview-637/wrap-mobile-open.png'
      ])
    })
  })

  it('joins native padded hyphen boundaries across three physical rows', () => {
    const rows = [
      '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web/',
      '.agent-state/qa/image-preview-',
      '637/fixtures/preview.png'
    ]
    const lines = rows.map((text) => ({
      length: 80,
      isWrapped: false,
      translateToString: () => text.padEnd(80, ' ')
    }))
    const onActivate = mock()
    const provider = createTerminalImageLinkProvider({
      isControlMode: () => false,
      getBufferLine: (index) => lines[index],
      onActivate
    })
    for (const row of [2, 3]) {
      provider.provideLinks(row, (links) => {
        expect(links?.length).toBe(1)
        expect(links?.[0]?.text).toBe(rows.join(''))
        links?.[0]?.activate(
          { button: 0 } as MouseEvent,
          links?.[0]?.text ?? ''
        )
      })
    }
    expect(onActivate.mock.calls[0]?.[0]).toBe(rows.join(''))
    expect(onActivate.mock.calls[1]?.[0]).toBe(rows.join(''))
  })

  describe('isImageExtension', () => {
    it('recognizes supported image extensions case-insensitively', () => {
      expect(isImageExtension('photo.png')).toBe(true)
      expect(isImageExtension('photo.PNG')).toBe(true)
      expect(isImageExtension('photo.jpg')).toBe(true)
      expect(isImageExtension('photo.jpeg')).toBe(true)
      expect(isImageExtension('photo.webp')).toBe(true)
      expect(isImageExtension('photo.WEBP')).toBe(true)
    })

    it('rejects unsupported extensions', () => {
      expect(isImageExtension('photo.svg')).toBe(false)
      expect(isImageExtension('photo.gif')).toBe(false)
      expect(isImageExtension('video.mp4')).toBe(false)
      expect(isImageExtension('page.html')).toBe(false)
      expect(isImageExtension('code.ts')).toBe(false)
    })
  })

  describe('isImageUrl', () => {
    it('detects http, https, file, and ftp protocols', () => {
      expect(isImageUrl('https://example.com/image.png')).toBe(true)
      expect(isImageUrl('http://localhost:8080/cat.jpg')).toBe(true)
      expect(isImageUrl('file:///Users/mahiro/doc.png')).toBe(true)
      expect(isImageUrl('ftp://server/img.webp')).toBe(true)
      expect(isImageUrl('/Users/mahiro/doc.png')).toBe(false)
      expect(isImageUrl('~/cat.png')).toBe(false)
      expect(isImageUrl('./relative.webp')).toBe(false)
    })
  })

  describe('cleanCandidatePath', () => {
    it('strips quotes and trailing punctuation', () => {
      expect(cleanCandidatePath('"~/images/photo.png"')).toBe(
        '~/images/photo.png'
      )
      expect(cleanCandidatePath("'./assets/icon.webp'")).toBe(
        './assets/icon.webp'
      )
      expect(cleanCandidatePath('/var/log/screen.jpg:')).toBe(
        '/var/log/screen.jpg'
      )
      expect(cleanCandidatePath('(/path/to/img.png)')).toBe('(/path/to/img.png')
      expect(cleanCandidatePath('/path/to/img.png,')).toBe('/path/to/img.png')
      expect(cleanCandidatePath('/path/to/img.png;')).toBe('/path/to/img.png')
    })
  })

  describe('Countertest: Real absolute path split 35 cols across >3 rows (actual isWrapped=false)', () => {
    const canonicalPath =
      '/Users/mahiro/ghq/github.com/mahirocoko/herdr-web/.agent-state/qa/image-preview-637/fixtures/preview.png'

    // Split at 35 columns:
    // Row 0: /Users/mahiro/ghq/github.com/mahir (35 chars)
    // Row 1: ocoko/herdr-web/.agent-state/qa/im (35 chars)
    // Row 2: age-preview-637/fixtures/preview.p (35 chars)
    // Row 3: ng                                (2 chars)
    const row0 = canonicalPath.slice(0, 35)
    const row1 = canonicalPath.slice(35, 70)
    const row2 = canonicalPath.slice(70, 105)
    const row3 = canonicalPath.slice(105)

    const bufferLines: IBufferLineLike[] = [
      {
        length: 35,
        isWrapped: false, // Explicit: isWrapped is false!
        translateToString: () => row0
      },
      {
        length: 35,
        isWrapped: false,
        translateToString: () => row1
      },
      {
        length: 35,
        isWrapped: false,
        translateToString: () => row2
      },
      {
        length: 35,
        isWrapped: false,
        translateToString: () => row3.padEnd(35, ' ')
      }
    ]

    it('middleRow (line 2) query returns ENTIRE canonical path, NOT a dangling tail', () => {
      const onActivateMock = mock()
      const provider = createTerminalImageLinkProvider({
        isControlMode: () => false,
        getBufferLine: (idx) => bufferLines[idx],
        onActivate: onActivateMock
      })

      let linksOnLine2: any
      // bufferLineNumber is 1-based, line 2 is Row 1 (ocoko/herdr-web/...)
      provider.provideLinks(2, (links) => {
        linksOnLine2 = links
      })

      expect(linksOnLine2).toBeDefined()
      expect(linksOnLine2.length).toBe(1)
      expect(linksOnLine2[0].text).toBe(canonicalPath)
      expect(linksOnLine2[0].range.start.y).toBe(1)
      expect(linksOnLine2[0].range.end.y).toBe(3)

      // Activating middleRow link returns entire canonical path
      linksOnLine2[0].activate(
        { button: 0 } as MouseEvent,
        linksOnLine2[0].text
      )
      expect(onActivateMock).toHaveBeenCalledWith(
        canonicalPath,
        expect.anything()
      )
    })

    it('all rows in the multiline path return the same canonical path', () => {
      const provider = createTerminalImageLinkProvider({
        isControlMode: () => false,
        getBufferLine: (idx) => bufferLines[idx],
        onActivate: () => {}
      })

      for (let lineNum = 1; lineNum <= 3; lineNum++) {
        let links: any
        provider.provideLinks(lineNum, (res) => {
          links = res
        })
        expect(links).toBeDefined()
        expect(links.length).toBe(1)
        expect(links[0].text).toBe(canonicalPath)
      }
    })
  })

  describe('Thai combining marks and CJK cell coordinate accuracy', () => {
    it('accurately maps CJK double-width preceding text and Thai combining marks to xterm cells', () => {
      // Line: "前缀: /tmp/ภาพไทย.png"
      // '前' (width 2, col 0..1), '缀' (width 2, col 2..3), ':' (width 1, col 4), ' ' (width 1, col 5)
      // '/tmp/' (col 6..10)
      // 'ภ' (col 11), 'า' (col 12), 'พ' (col 13), 'ไ' (col 14), 'ท' (col 15), 'ย' (col 16)
      // '.png' (col 17..20)
      const mockCells: IBufferCellLike[] = [
        { getChars: () => '前', getWidth: () => 2 },
        { getChars: () => '', getWidth: () => 0 }, // CJK trail
        { getChars: () => '缀', getWidth: () => 2 },
        { getChars: () => '', getWidth: () => 0 }, // CJK trail
        { getChars: () => ':', getWidth: () => 1 },
        { getChars: () => ' ', getWidth: () => 1 },
        { getChars: () => '/', getWidth: () => 1 },
        { getChars: () => 't', getWidth: () => 1 },
        { getChars: () => 'm', getWidth: () => 1 },
        { getChars: () => 'p', getWidth: () => 1 },
        { getChars: () => '/', getWidth: () => 1 },
        { getChars: () => 'ภ', getWidth: () => 1 },
        { getChars: () => 'า', getWidth: () => 1 },
        { getChars: () => 'พ', getWidth: () => 1 },
        { getChars: () => 'ไ', getWidth: () => 1 },
        { getChars: () => 'ท', getWidth: () => 1 },
        { getChars: () => 'ย', getWidth: () => 1 },
        { getChars: () => '.', getWidth: () => 1 },
        { getChars: () => 'p', getWidth: () => 1 },
        { getChars: () => 'n', getWidth: () => 1 },
        { getChars: () => 'g', getWidth: () => 1 }
      ]

      const bufferLine: IBufferLineLike = {
        length: mockCells.length,
        isWrapped: false,
        translateToString: () => '前缀: /tmp/ภาพไทย.png',
        getCell: (x) => mockCells[x]
      }

      const processed = processBufferLine(bufferLine, 1)
      expect(processed.text).toBe('前缀: /tmp/ภาพไทย.png')

      const candidates = findImageCandidatesInWindow([processed], 1)
      expect(candidates.length).toBe(1)
      expect(candidates[0].cleanedPath).toBe('/tmp/ภาพไทย.png')
      // Path starts at '/' which is at 1-based cell coordinate 7 (0-based col 6)
      expect(candidates[0].range.start.x).toBe(7)
      expect(candidates[0].range.end.x).toBe(21)
    })

    it('preserves spaces and combining characters inside quoted paths across rows', () => {
      // Row 1: "preview รูปภาพ
      // Row 2: ไทย.png"
      const line1: IBufferLineLike = {
        length: 20,
        isWrapped: false,
        translateToString: () => '"preview รูปภาพ'
      }
      const line2: IBufferLineLike = {
        length: 20,
        isWrapped: false,
        translateToString: () => 'ไทย.png"'
      }

      const p1 = processBufferLine(line1, 1)
      const p2 = processBufferLine(line2, 2)

      const candidates = findImageCandidatesInWindow([p1, p2], 1)
      expect(candidates.length).toBe(1)
      expect(candidates[0].cleanedPath).toBe('preview รูปภาพไทย.png')
      expect(candidates[0].range.start.y).toBe(1)
      expect(candidates[0].range.end.y).toBe(2)
    })
  })

  describe('Security and mode control guards', () => {
    it('returns undefined when in control mode', () => {
      const provider = createTerminalImageLinkProvider({
        isControlMode: () => true,
        getBufferLine: () => ({
          length: 20,
          translateToString: () => '/path/to/test.png'
        }),
        onActivate: () => {}
      })

      const callback = mock()
      provider.provideLinks(1, callback)
      expect(callback).toHaveBeenCalledWith(undefined)
    })

    it('does not link remote URLs or file schemes', () => {
      const bufferLine: IBufferLineLike = {
        length: 60,
        translateToString: () =>
          'See https://example.com/test.png and file:///etc/pic.jpg'
      }

      const processed = processBufferLine(bufferLine, 1)
      const candidates = findImageCandidatesInWindow([processed], 1)
      expect(candidates.length).toBe(0)
    })

    it('ignores clicks when mouse button is not primary or text is selected', () => {
      const onActivateMock = mock()
      const provider = createTerminalImageLinkProvider({
        isControlMode: () => false,
        getBufferLine: () => ({
          length: 20,
          translateToString: () => '/tmp/photo.png'
        }),
        onActivate: onActivateMock
      })

      let link: any
      provider.provideLinks(1, (links) => {
        link = links?.[0]
      })

      expect(link).toBeDefined()

      // Non-primary click (right click)
      link.activate({ button: 2 } as MouseEvent, link.text)
      expect(onActivateMock).not.toHaveBeenCalled()
    })
  })
})
