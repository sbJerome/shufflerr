// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
/* eslint-disable no-console */
import path from 'path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const hformat = winston.format.printf(
  ({ level, label, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]${
      label ? `[${label}]` : ''
    }: ${message} `;
    if (Object.keys(metadata).length > 0) {
      msg += JSON.stringify(metadata);
    }
    return msg;
  }
);

const fileTransport = new winston.transports.DailyRotateFile({
  filename: process.env.CONFIG_DIRECTORY
    ? `${process.env.CONFIG_DIRECTORY}/logs/shufflerr-%DATE%.log`
    : path.join(__dirname, '../config/logs/shufflerr-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '7d',
  createSymlink: true,
  symlinkName: 'shufflerr.log',
});
const machineLogFileTransport = new winston.transports.DailyRotateFile({
  filename: process.env.CONFIG_DIRECTORY
    ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs-%DATE%.json`
    : path.join(__dirname, '../config/logs/.machinelogs-%DATE%.json'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '1d',
  createSymlink: true,
  symlinkName: '.machinelogs.json',
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp(),
    winston.format.json()
  ),
});

fileTransport.on('error', (err) => {
  console.error('Error in shufflerr file transport:', err);
});

machineLogFileTransport.on('error', (err) => {
  console.error('Error in machine log file transport:', err);
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || 'debug',
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp(),
    hformat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.splat(),
        winston.format.timestamp(),
        hformat
      ),
    }),
    fileTransport,
    machineLogFileTransport,
  ],
});

export default logger;
