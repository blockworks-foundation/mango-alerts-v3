import Koa from "koa"
import Router from "koa-router"
import mongo from "koa-mongo"
import bodyParser from "koa-bodyparser"
import cors from "@koa/cors"
import * as cron from "node-cron"
import { MongoClient, ObjectId } from "mongodb"

import {
  Cluster,
  Config,
  MangoClient,
  IDS,
} from "@blockworks-foundation/mango-client"
import { Commitment, Connection, PublicKey } from "@solana/web3.js"

import { UserError } from "./errors"
import {
  validateMangoAccount,
  validateEmail,
  sendAlert,
  validateUpdatePassword,
} from "./utils"
import config from "./environment"

const MESSAGE = "Your health ratio is at or below @ratio@% \n"

const app = new Koa()
const router = new Router()

const clientConfig = new Config(IDS)

const cluster = (process.env.CLUSTER || "mainnet") as Cluster
const groupName = process.env.GROUP || "mainnet.1"
const groupIds = clientConfig.getGroup(cluster, groupName)
if (!groupIds) {
  throw new Error(`Group ${groupName} not found`)
}

const mangoProgramId = groupIds.mangoProgramId

const connection = new Connection(
  process.env.ENDPOINT_URL || clientConfig.cluster_urls[cluster],
  "processed" as Commitment
)

const client = new MangoClient(connection, mangoProgramId)

let db: any

app.use(cors())
app.use(bodyParser())
app.use(
  mongo(
    {
      uri: config.dbConnectionString,
    },
    { useUnifiedTopology: true }
  )
)

router.post("/alerts", async (ctx, next) => {
  try {
    const alert: any = ctx.request.body
    await validateMangoAccount(client, alert)
    validateEmail(alert.email)
    ctx.body = { status: "success" }
    alert.open = true
    alert.timestamp = Date.now()
    ctx.db.collection("alerts").insertOne(alert)
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    } else {
      // sendLogsToDiscord(null, e)
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

router.post("/delete-alert", async (ctx, next) => {
  try {
    const id: any = new ObjectId(ctx.request.body.id)
    if (id) {
      ctx.body = { status: "success" }
    }
    ctx.db.collection("alerts").deleteOne({ _id: id })
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

router.get("/alerts/:mangoAccountPk", async (ctx, next) => {
  try {
    const { mangoAccountPk } = ctx.params
    if (!mangoAccountPk) {
      throw new UserError("Missing margin account")
    }
    const alerts = await ctx.db
      .collection("alerts")
      .find(
        { mangoAccountPk },
        {
          projection: {
            _id: 1,
            health: 1,
            alertProvider: 1,
            open: 1,
            timestamp: 1,
            triggeredTimestamp: 1,
            notifiAlertId: 1,
          },
        }
      )
      .toArray()
    ctx.body = { alerts }
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    } else {
      // sendLogsToDiscord(null, e)
    }
    ctx.throw(400, errorMessage)
  }
})

router.post("/updates", async (ctx, next) => {
  try {
    const req: any = ctx.request.body
    const update = { ...req.update, date: Date.now() }
    await validateUpdatePassword(req.password)
    ctx.body = { status: "success" }
    ctx.db.collection("updates").insertOne(update)
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

router.get("/get-updates", async (ctx, next) => {
  try {
    const updates = await ctx.db.collection("updates").find().toArray()
    ctx.body = { updates }
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    } else {
      // sendLogsToDiscord(null, e)
    }
    ctx.throw(400, errorMessage)
  }
})

router.post("/delete-update", async (ctx, next) => {
  try {
    const id: any = new ObjectId(ctx.request.body.id)
    const password: string = ctx.request.body.password
    await validateUpdatePassword(password)
    if (id) {
      ctx.body = { status: "success" }
    }
    ctx.db.collection("updates").deleteOne({ _id: id })
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

router.post("/update-seen", async (ctx, next) => {
  try {
    const update: any = ctx.request.body
    if (update) {
      ctx.body = { status: "success" }
    }
    ctx.db
      .collection("updates")
      .updateOne(
        { _id: new ObjectId(update._id) },
        { $set: { hasSeen: update.hasSeen } }
      )
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

router.post("/clear-updates", async (ctx, next) => {
  try {
    const update: any = ctx.request.body
    if (update) {
      ctx.body = { status: "success" }
    }
    ctx.db
      .collection("updates")
      .updateOne(
        { _id: new ObjectId(update._id) },
        { $set: { hasCleared: update.hasCleared } }
      )
  } catch (e: any) {
    let errorMessage = "Something went wrong"
    if (e.name == "UserError") {
      errorMessage = e.message
    }
    ctx.throw(400, errorMessage)
  }
  await next()
})

app.use(router.allowedMethods())
app.use(router.routes())

app.listen(config.port, () => {
  const readyMessage = `> Server ready on http://localhost:${config.port}`
  console.log(readyMessage)
  // sendLogsToDiscord(readyMessage, null)
})

const handleAlert = async (alert: any, db: any) => {
  try {
    const mangoAccountPk = new PublicKey(alert.mangoAccountPk)
    const mangoGroupPk = new PublicKey(alert.mangoGroupPk)
    const mangoGroup = await client.getMangoGroup(mangoGroupPk)
    const mangoCache = await mangoGroup.loadCache(connection)
    const mangoAccount = await client.getMangoAccount(
      mangoAccountPk,
      mangoGroup.dexProgramId
    )
    const health = await mangoAccount.getHealthRatio(
      mangoGroup,
      mangoCache,
      "Maint"
    )
    if (health.toNumber() <= parseFloat(alert.health)) {
      let message = MESSAGE.replace("@ratio@", alert.health)
      message +=
        "Deposit more collateral or reduce your liabilities to improve your account health. \n"
      message += `View your account: https://trade.mango.markets/account?pubkey=${alert.mangoAccountPk}`
      const alertSent = await sendAlert(alert, message)
      if (alertSent) {
        db.collection("alerts").deleteOne({ _id: alert._id })
      }
    }
  } catch (e) {
    console.log(e)
    // sendLogsToDiscord(null, e)
  }
}

const runCron = async () => {
  const uri = config.dbConnectionString
  const mongoClient = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  const mongoConnection = await mongoClient.connect()
  if (!db) db = mongoConnection.db("mango")
  cron.schedule("* * * * *", async () => {
    try {
      const alerts: any[] = await db
        .collection("alerts")
        .find({ open: true })
        .toArray()

      const updates: any[] = await db
        .collection("updates")
        .find({ expiryDate: { $lt: Date.now() } })
        .toArray()

      updates.forEach(async (update) => {
        db.collection("updates").deleteOne({ _id: update._id })
      })

      alerts.forEach(async (alert) => {
        handleAlert(alert, db)
      })
    } catch (e) {
      console.log(e)
      // sendLogsToDiscord(null, e)
    }
  })
}

runCron()
