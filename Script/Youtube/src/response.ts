/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { Browse } from '../lib/protobuf/response/browse_pb.js'
import { Next } from '../lib/protobuf/response/next_pb.js'
import { Search } from '../lib/protobuf/response/search_pb.js'
import { Shorts } from '../lib/protobuf/response/shorts_pb.js'
import { Guide } from '../lib/protobuf/response/guide_pb.js'
import { Player, BackgroundPlayer, TranslationLanguage, CaptionTrack } from '../lib/protobuf/response/player_pb.js'
import { Setting, SubSetting, SettingItem } from '../lib/protobuf/response/setting_pb.js'
import { Watch } from '../lib/protobuf/response/watch_pb.js'

import { YouTubeMessage } from './youtube'
import { $ } from '../lib/env'
import { translateURL } from '../lib/googleTranslate'
import { Entity } from '../lib/protobuf/response/frameworkUpdate_pb.js'
import { protoBase64 } from '@bufbuild/protobuf'
import { GlobalConfigGroup } from '../lib/protobuf/response/config_pb'
import { OnesieInnertubeResponse } from '../lib/protobuf/ump/onesieInnertubeResponse_pb'

export class BrowseMessage extends YouTubeMessage {
  constructor (msgType: any = Browse, name: string = 'Browse') {
    super(msgType, name)
  }

  async pure (): Promise<YouTubeMessage> {
    this.iterate(this.message, 'richGridContents', (obj) => {
      for (let i = obj.richGridContents.length - 1; i >= 0; i--) {
        this.removeCommonAD(obj, i)
        this.removeShorts(obj, i)
      }
    })
    // this.addClientKey()
    // this.removeFrameworkUpdateAd()
    await this.translate()
    return this
  }

  addClientKey (): void {
    if (!this.message.responseContext) {
      return
    }
    this.message.responseContext.globalConfigGroup = new GlobalConfigGroup(
      {
        hotConfigGroup: {
          mediaHotConfig: {
            onesieHotConfig: {
              clientKey: new Uint8Array([
                  254, 182, 69, 182, 237, 221, 161, 115,
                  72, 7, 88, 165, 188, 249, 44, 160,
                  17, 94, 65, 219, 151, 209, 82, 6,
                  152, 187, 188, 81, 52, 82, 181, 148
                ]
              ),
              encryptKey: new Uint8Array([
                  0, 170, 76, 193, 204, 43, 169, 7, 152, 73,
                  130, 130, 80, 182, 25, 54, 93, 41, 16, 60,
                  137, 32, 187, 146, 187, 223, 219, 5, 32, 147,
                  28, 251, 20, 204, 93, 210, 255, 151, 129, 195,
                  224, 84, 167, 162, 189, 76, 184, 133, 153, 16,
                  164, 151, 71
                ]
              ),
              keyExpiresInSeconds: 259200n,
              useHotConfigToCreateOnesieRequest: true
            }
          }
        }
      })
    this.needProcess = true
  }

  removeCommonAD (obj: any, index: number): void {
    const content = obj.richGridContents[index]
    const richItemContent = content?.richItemRenderer?.richItemContent
    for (let j = richItemContent?.length - 1; j >= 0; j--) {
      if (this.isAdvertise(richItemContent[j])) {
        richItemContent.splice(j, 1)
        this.needProcess = true
      }
    }
  }

  removeShorts (obj: any, index: number): void {
    const richSectionRenderer = obj.richGridContents[index]?.richSectionRenderer
    if (this.isShorts(richSectionRenderer)) {
      obj.richGridContents.splice(index, 1)
      this.needProcess = true
    }
  }

  getBrowseId (): string {
    let browseId = ''
    this.iterate(this.message?.responseContext, 'key', (obj, stack) => {
      if (obj.key === 'browse_id') {
        browseId = obj.value
        stack.length = 0
      }
    })
    return browseId
  }

  async translate (): Promise<void> {
    const lyricTargetLang = this.argument.lyricLang?.trim()
    if (!(this.name === 'Browse' && this.getBrowseId().startsWith('MPLYt')) || lyricTargetLang === 'off') return
    let lyric = ''
    let tempObj: any
    let flag = false
    this.iterate(this.message, 'timedLyricsContent', (obj, stack) => {
      tempObj = obj.timedLyricsContent
      lyric = obj.timedLyricsContent.runs.map((item) => item.text).join('\n')
      flag = true
      stack.length = 0
    })
    if (!flag) {
      this.iterate(this.message, 'description', (obj, stack) => {
        tempObj = obj.description.runs[0]
        lyric = obj.description.runs[0].text
        stack.length = 0
        flag = true
      })
    }
    if (!flag) return

    const origin = lyricTargetLang.split('-')[0]
    const url = translateURL(lyric, lyricTargetLang)
    const resp = await $.fetch({
      method: 'GET',
      url
    })
    if (resp.status === 200 && resp.body) {
      const data = JSON.parse(resp.body)
      const tips = ' & Translated by Google'
      const isOrigin = data[2].includes(origin)

      if (tempObj.text) {
        tempObj.text = data[0].map((item) => isOrigin ? item[0] : item[1] + item[0] || '').join('\r\n')
        this.iterate(this.message, 'footer', (ob, stack) => {
          ob.footer.runs[0].text += tips
          stack.length = 0
        })
      } else {
        if (tempObj.runs.length <= data[0].length) {
          tempObj.runs.forEach((item, i) => {
            item.text = isOrigin ? data[0][i][0] : item.text + `\n${data[0][i][0] as string}`
          })
          tempObj.footerLabel += tips
        }
      }
      this.needProcess = true
    }
  }

  removeFrameworkUpdateAd (): void {
    const mutations = this.message?.frameworkUpdateTransport?.entityBatchUpdate?.mutations
    if (!mutations) return

    for (let j = mutations.length - 1; j >= 0; j--) {
      const mutation = mutations[j]
      const entity = Entity.fromBinary(protoBase64.dec(decodeURIComponent(mutation.entityKey)))
      let adFlag = this.blackEml.includes(entity.name)
      if (!adFlag && this.checkUnknownFiled(mutation?.payload)) {
        adFlag = true
        this.blackEml.push(entity.name)
        this.needSave = true
      }
      if (adFlag) {
        mutations.splice(j, 1)
        this.needProcess = true
      }
    }
  }
}

export class NextMessage extends BrowseMessage {
  constructor (msgType: any = Next, name: string = 'Next') {
    super(msgType, name)
  }
}

export class PlayerMessage extends YouTubeMessage {
  constructor (msgType: any = Player, name: string = 'Player') {
    super(msgType, name)
  }

  pure (): YouTubeMessage {
    // 去除广告
    if (this.message.adPlacements?.length) {
      this.message.adPlacements.length = 0
    }
    if (this.message.adSlots?.length) {
      this.message.adSlots.length = 0
    }
    // 去除广告追踪
    delete this.message?.playbackTracking?.pageadViewthroughconversion
    // 增加 premium 特性
    this.addPlayAbility()
    this.addTranslateCaption()
    this.needProcess = true
    return this
  }

  addPlayAbility (): void {
    // 开启画中画
    const miniPlayerRender = this.message?.playabilityStatus?.miniPlayer?.miniPlayerRender
    if (typeof miniPlayerRender === 'object') {
      miniPlayerRender.active = true
    }
    // 开启后台播放
    if (typeof this.message.playabilityStatus === 'object') {
      this.message.playabilityStatus.backgroundPlayer = new BackgroundPlayer({
        backgroundPlayerRender: {
          active: true
        }
      })
    }
  }

  addTranslateCaption (): void {
    const captionTargetLang = this.argument.captionLang as string
    if (captionTargetLang === 'off') return

    this.iterate(this.message, 'captionTracks', (obj, stack) => {
      const captionTracks = obj.captionTracks
      const audioTracks = obj.audioTracks

      // 添加默认翻译语言
      if (Array.isArray(captionTracks)) {
        const captionPriority = {
          [captionTargetLang]: 2,
          en: 1
        }
        let priority = -1
        let targetIndex = 0

        for (let i = 0; i < captionTracks.length; i++) {
          const captionTrack = captionTracks[i]
          const currentPriority = captionPriority[captionTrack.languageCode]
          if (currentPriority && (currentPriority > priority)) {
            priority = currentPriority
            targetIndex = i
          }
          captionTrack.isTranslatable = true
        }

        if (priority !== 2) {
          const newCaption = new CaptionTrack({
            baseUrl: captionTracks[targetIndex].baseUrl + `&tlang=${captionTargetLang}`,
            name: { runs: [{ text: `@Enhance (${captionTargetLang})` }] },
            vssId: `.${captionTargetLang}`,
            languageCode: captionTargetLang
          })
          captionTracks.push(newCaption)
        }

        // 开启默认字幕
        if (Array.isArray(audioTracks)) {
          const trackIndex = priority === 2 ? targetIndex : captionTracks.length - 1
          for (const audioTrack of audioTracks) {
            if (!audioTrack.captionTrackIndices?.includes(trackIndex)) {
              audioTrack.captionTrackIndices.push(trackIndex)
            }
            audioTrack.defaultCaptionTrackIndex = trackIndex
            audioTrack.captionsInitialState = 3
          }
        }
      }

      // 重建自动翻译
      const languages = {
        de: 'Deutsch',
        ru: 'Русский',
        fr: 'Français',
        fil: 'Filipino',
        ko: '한국어',
        ja: '日本語',
        en: 'English',
        vi: 'Tiếng Việt',
        'zh-Hant': '中文（繁體）',
        'zh-Hans': '中文（简体）',
        und: '@VirgilClyne'
      }
      obj.translationLanguages =
        Object.entries(languages).map(([k, v]) => new TranslationLanguage({
          languageCode: k,
          languageName: { runs: [{ text: v }] }
        }))
      stack.length = 0
    })
  }
}

export class SearchMessage extends BrowseMessage {
  constructor (msgType: any = Search, name: string = 'Search') {
    super(msgType, name)
  }
}

export class ShortsMessage extends YouTubeMessage {
  constructor (msgType: any = Shorts, name: string = 'Shorts') {
    super(msgType, name)
  }

  pure (): YouTubeMessage {
    const shortsRawLength = this.message.entries?.length
    if (shortsRawLength) {
      for (let i = shortsRawLength - 1; i >= 0; i--) {
        if (!this.message.entries[i].command?.reelWatchEndpoint?.overlay) {
          this.message.entries.splice(i, 1)
          this.needProcess = true
        }
      }
    }
    return this
  }
}

export class GuideMessage extends YouTubeMessage {
  constructor (msgType: any = Guide, name: string = 'Guide') {
    super(msgType, name)
  }

  pure (): YouTubeMessage {
    const blackList = ['SPunlimited']
    if (this.argument.blockUpload) blackList.push('FEuploads')
    if (this.argument.blockImmersive) blackList.push('FEmusic_immersive')
    this.iterate(this.message, 'rendererItems', (obj) => {
      for (let i = obj.rendererItems.length - 1; i >= 0; i--) {
        const browseId =
          obj.rendererItems[i]?.iconRender?.browseId ||
          obj.rendererItems[i]?.labelRender?.browseId
        if (blackList.includes(browseId)) {
          obj.rendererItems.splice(i, 1)
          this.needProcess = true
        }
      }
    })
    return this
  }
}

export class SettingMessage extends YouTubeMessage {
  constructor (msgType: any = Setting, name: string = 'Setting') {
    super(msgType, name)
  }

  pure (): YouTubeMessage {
    // 增加 PIP
    this.iterate(this.message, 'categoryId', (obj) => {
      if (obj.categoryId === 10005) {
        const trackingParams = {
          f1: 135,
          f2: 20434,
          f3: 2,
          timeInfo: this.message.trackingParams.timeInfo
        }
        const fakePIPSetting = new SubSetting({
          settingBooleanRenderer: {
            itemId: 0,
            enableServiceEndpoint: {
              trackingParams,
              setClientSettingEndpoint: {
                settingDatas: {
                  clientSettingEnum: { item: 151 },
                  boolValue: true
                }
              }
            },
            disableServiceEndpoint: {
              trackingParams,
              setClientSettingEndpoint: {
                settingDatas: {
                  clientSettingEnum: { item: 151 },
                  boolValue: false
                }
              }
            },
            clickTrackingParams: trackingParams
          }
        })

        obj.subSettings.push(fakePIPSetting)
      }
    })
    // 增加后台播放
    const fakePlayBackgroundSetting = new SettingItem({
      settingCategoryEntryRenderer: {
        f2: 1,
        f3: 1,
        trackingParams: {
          f1: 2,
          f2: 20020,
          f3: 8,
          timeInfo: this.message.trackingParams.timeInfo
        },
        f6: 0,
        f7: 1,
        f8: 1,
        f9: 1,
        f10: 1,
        f12: 1
      }
    })
    this.message.settingItems.push(fakePlayBackgroundSetting)
    this.needProcess = true
    return this
  }
}

// export class WatchMessage extends PlayerMessage {
//   constructor (msgType: any = Watch, name: string = 'Watch') {
//     super(msgType, name)
//   }
//
//   pure (): YouTubeMessage {
//     const tempMsg = this.message
//     this.iterate(this.message, 'player', (obj, stack) => {
//       this.message = obj.player
//       super.pure()
//       this.message = tempMsg
//       stack.length = 0
//     })
//     return this
//   }
// }
export class WatchMessage extends YouTubeMessage {
  player: PlayerMessage
  next: NextMessage

  constructor (msgType: any = Watch, name: string = 'Watch') {
    super(msgType, name)
    this.player = new PlayerMessage()
    this.next = new NextMessage()
  }

  async pure (): Promise<YouTubeMessage> {
    for (const msg of this.message.contents) {
      if (msg.player) {
        this.player.message = msg.player
        await this.player.pure()
      }
      if (msg.next) {
        this.next.message = msg.next
        await this.next.pure()
      }
      this.needProcess = true
    }
    return this
  }
}
