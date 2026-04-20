const { Router } = require('express')
const audio = require('../lib/audio.cjs')

const router = Router()

router.get('/devices', (_req, res) => {
  res.json(audio.listInputDevices())
})

module.exports = router
