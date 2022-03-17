import * as nodemailer from "nodemailer"
import * as EmailValidator from "email-validator"

import { MangoClient } from "@blockworks-foundation/mango-client"
import { PublicKey } from "@solana/web3.js"
import {
  NotifiClient,
  NotifiEnvironment,
  createAxiosInstance,
} from '@notifi-network/notifi-node';
import axios from 'axios';

import { UserError } from "./errors"

import config from "./environment"
import { randomUUID } from "crypto"

const mailjetTransport = require("nodemailer-mailjet-transport")

// Initialize Notifi client
const env: NotifiEnvironment = 'Development';
const axiosInstance = createAxiosInstance(axios, env);
const notifiClient = new NotifiClient(axiosInstance);

export const validateMangoAccount = (client: MangoClient, alert: any) => {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const mangoGroupPk = new PublicKey(alert.mangoGroupPk)
      const mangoAccountPk = new PublicKey(alert.mangoAccountPk)
      const mangoGroup = await client.getMangoGroup(mangoGroupPk)
      const mangoAccount = await client.getMangoAccount(
        mangoAccountPk,
        mangoGroup.dexProgramId
      )
      if (!mangoGroup || !mangoAccount) {
        reject(new UserError("Invalid mango account or mango group"))
      } else {
        resolve()
      }
    } catch (e) {
      reject(new UserError("Invalid mango account or mango group"))
    }
  })
}

export const validateUpdatePassword = (password: string) => {
  return new Promise<void>(async (resolve, reject) => {
    try {
      if (password != config.updatePassword) {
        reject(new UserError("Invalid password"))
      } else {
        resolve()
      }
    } catch (e) {
      reject(new UserError("Invalid password"))
    }
  })
}

export const validateEmail = (email: string) => {
  if (!EmailValidator.validate(email)) {
    throw new UserError("Enter a valid email")
  }
  return
}

export const validateNotifiAlertId = (notifiAlertId: string) => {
  if (!notifiAlertId) {
    throw new UserError("Invalid notifiAlertId")
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
    await transport.sendMail(mailOptions)
    return true
  } catch (err) {
    console.error(err)
  }

  return false
}

const sendNotifiAlert = async (alertId: string, health: number, walletPublicKey: string ) => {
  const sid = config.notifiSid
  const secret = config.notifiSecret
  if (!sid || !secret) {
    throw new UserError("Missing sid/secret pair")
  }

  try {
    // login with sid/secret to get jwt
    const { token: jwt, expiry } = await notifiClient.logIn({ sid, secret })
    console.log(`login successfully, received jwt expire at ${expiry}`)
    if (jwt) {
      // trigger notifi to send notification
      const key = randomUUID()
      await notifiClient.sendSimpleHealthThreshold(jwt, {
        key,
        walletPublicKey,
        walletBlockchain: "SOLANA",
        healthValue: health,
      })
      console.log(`sending alert with key: ${key}, walletPublicKey: ${walletPublicKey}, value: ${health}`);
      return true
    } else {
      throw new UserError("Invalid jwt, please login")
    }
  } catch (err) {
    console.error(err)
    throw err
  }
}

export const sendAlert = async (alert: any, message: string, health: number, walletPublicKey: string) => {
  if (alert.alertProvider == "mail") {
    const email = alert.email
    const emailSent = await sendEmail(email, message)
    return emailSent
  } else if (alert.alertProvider == "notifi") {
    try {
      const alertSent = await sendNotifiAlert(alert.notifiAlertId, health, walletPublicKey)
      return alertSent;
    } catch (err) {
      console.error(err)
      return false
    }
  }

  return false
}
