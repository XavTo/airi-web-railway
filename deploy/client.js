// Loaded before Stage initializes Pinia. Never put credentials in this file.
(() => {
  const { chat, speech, transcription, voice } = globalThis.AIRI_SELFHOST
  const key = 'settings/providers/configured'
  const list = 'settings/providers/added'
  const origin = location.origin
  const chatId = 'openai-compatible'
  const speechId = 'openai-compatible-audio-speech'
  const sttId = 'openai-compatible-audio-transcription'
  try {
    const providers = JSON.parse(localStorage.getItem(key) ?? '{}')
    const added = JSON.parse(localStorage.getItem(list) ?? '{}')
    for (const [id, config] of [
      [chatId, { baseUrl: `${origin}/local/chat/v1/`, model: chat }],
      [speechId, { baseUrl: `${origin}/local/voice/v1/`, model: speech, voice }],
      [sttId, { baseUrl: `${origin}/local/voice/v1/`, model: transcription }],
    ]) {
      if (!providers[id]) {
        providers[id] = { id, definitionId: id, config: { ...config, apiKey: 'local-session' }, status: 'configured', configuredBy: 'user' }
        added[id] = true
      }
    }
    localStorage.setItem(key, JSON.stringify(providers))
    localStorage.setItem(list, JSON.stringify(added))
    for (const [k, v] of Object.entries({
      'consciousness/active-provider': chatId,
      'consciousness/active-model': chat,
      'speech/active-provider': speechId,
      'speech/active-model': speech,
      'speech/voice': voice,
      'hearing/active-provider': sttId,
      'hearing/active-model': transcription,
    })) {
      const name = `settings/${k}`
      if (!localStorage.getItem(name))
        localStorage.setItem(name, v)
    }
  }
  catch (err) {
    console.warn('AIRI self-host defaults could not be loaded', err)
  }
})()
