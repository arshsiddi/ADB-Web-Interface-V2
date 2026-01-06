# Deployment Guide – ADB Web Interface

This document explains the **complete deployment workflow** for the ADB Web Interface project.  
It is intended for **demonstration and reference purposes** and reflects how the system is deployed in a **secure, private production environment**.

The live system runs on an **AWS EC2 Free Tier instance** and is accessed only through a **private network** using Tailscale.

---

## Deployment Overview

The deployment consists of:

- A **React frontend** built locally and served by the backend  
- A **Node.js backend** running on AWS EC2  
- **PM2** for process management  
- **Tailscale** for secure private access  
- **ADB tools** for Android device communication  

This setup ensures:
- No public exposure of sensitive services  
- Secure device communication  
- Controlled access to the application  

---

## Environment Requirements

### Server
- AWS EC2 (Amazon Linux)
- Node.js v16+
- PM2 (global install)
- Tailscale
- Android Debug Bridge (ADB)

### Local Machine
- Node.js
- npm
- Git

---

## Directory Structure on Server

Create the required directories on the EC2 instance:

```bash
sudo mkdir -p /home/ec2-user/adb-app
sudo mkdir -p /home/ec2-user/adb-app/logs
sudo chown ec2-user:ec2-user /home/ec2-user/adb-app -R
