// import { MongoClient } from "mongodb"
import * as nodemailer from "nodemailer"
import * as EmailValidator from "email-validator"

import { MangoClient } from "@blockworks-foundation/mango-client"
import { PublicKey } from "@solana/web3.js"

import { UserError } from "./errors"

import config from "./environment"

const mailjetTransport = require("nodemailer-mailjet-transport")

// // This needs to be global because it uses event listeners
// // const bot = new TelegramBot.default(config.tgToken, {polling: true});
// const twilioClient = new Twilio(config.twilioSid, config.twilioToken)

export const validateMangoAccount = (client: MangoClient, alert: any) => {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const mangoGroupPk = new PublicKey(alert.mangoGroupPk)
      const mangoAccountPk = new PublicKey(alert.marginAccountPk)
      const mangoGroup = await client.getMangoGroup(mangoGroupPk)
      const mangoAccount = await client.getMangoAccount(
        mangoAccountPk,
        mangoGroup.dexProgramId
      )
      if (!mangoGroup || !mangoAccount) {
        reject(new UserError("Invalid margin account or mango group"))
      } else {
        resolve()
      }
    } catch (e) {
      reject(new UserError("Invalid margin account or mango group"))
    }
  })
}

export const validateEmail = (email: string) => {
  if (!EmailValidator.validate(email)) {
    throw new UserError("The entered email is incorrect")
  }
  return
}

const sendEmail = async (email: string, message: string) => {
  const transport = nodemailer.createTransport(
    mailjetTransport({
      auth: {
        apiKey: config.mailJetKey,
        apiSecret: config.mailJetSecret,
      },
    })
  )
  const mailOptions = {
    from: `${config.mailUser}@mango.markets`,
    to: email,
    subject: "Mango Alerts",
    text: message,
  }

  try {
    const info = await transport.sendMail(mailOptions)
    console.log(info)
  } catch (err) {
    console.error(err)
  }
  transport.sendMail(mailOptions)
}

export const sendAlert = async (alert: any, message: string) => {
  if (alert.alertProvider == "mail") {
    const email = alert.email
    sendEmail(email, message)
  }
  return true
}
