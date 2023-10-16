import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";

// Get some configuration values or set default values.
const config = new pulumi.Config();

// Create VPC.
const vpc = new awsx.ec2.Vpc(
  "vpc",
  {},
  { protect: true }
);

// For SSH access when debugging
// Loading an existing public key
let publicKey = fs.readFileSync("./id.pub", "");

// Create a new Key Pair
const keyPair = new aws.ec2.KeyPair(
  "myKeyPair",
  {
    publicKey: publicKey,
  },
  { protect: true }
);

// Create a security group allowing outbound access over alb
const albSecGroup = new aws.ec2.SecurityGroup(
  "lb",
  {
    description: "Enable HTTP access",
    vpcId: vpc.vpcId,
    ingress: [
      {
        fromPort: 80,
        toPort: 80,
        protocol: "tcp", // HTTP traffic
        cidrBlocks: ["0.0.0.0/0"], // Allow from all IPs
        ipv6CidrBlocks: ["::/0"],
      },
      {
        fromPort: 443,
        toPort: 443,
        protocol: "tcp", // HTTPS traffic
        cidrBlocks: ["0.0.0.0/0"], // Allow from all IPs
        ipv6CidrBlocks: ["::/0"],
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  },
  { protect: true }
);

// Create a security group allowing inbound access over alb
const defaultSecGroup = new aws.ec2.SecurityGroup(
  "default",
  {
    description: "Enable HTTP access",
    vpcId: vpc.vpcId,
    ingress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1", // All traffic
        securityGroups: [albSecGroup.id], // reference to another security group
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  },
  { protect: true }
);

// Get an Amazon-issued SSL/TLS certificate
const certificateArn = aws.acm
  .getCertificate({
    domain: "testsite.com",
    mostRecent: true,
  })
  .then((invoke) => invoke.arn);

// An Application Load Balancer to distribute incoming traffic across multiple targets
const alb = new awsx.lb.ApplicationLoadBalancer(
  "alb",
  {
    internal: false,
    idleTimeout: 1800,
    securityGroups: [defaultSecGroup.id, albSecGroup.id],
    subnetIds: vpc.publicSubnetIds,
    listener: {
      port: 80,
      protocol: "HTTP",
      defaultActions: [
        {
          type: "redirect",
          redirect: {
            protocol: "HTTPS",
            statusCode: "HTTP_301",
            port: "443",
          },
        },
      ],
    },
  },
  { protect: true }
);

const listener443 = new aws.lb.Listener(
  "sxsyd-listener-443",
  {
    loadBalancerArn: alb.loadBalancer.arn,
    port: 443,
    protocol: "HTTPS",
    certificateArn: certificateArn,
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: {
          contentType: "application/json",
          messageBody: `{ "error": "Service Unavailable" }`,
          statusCode: "503",
        },
      },
    ],
  },
  { protect: true }
);

// Create ECS Cluster
const clustereLogGroup = new aws.cloudwatch.LogGroup(
  "clusterLogGroup",
  {},
  { protect: true }
);

const cluster = new aws.ecs.Cluster(
  "dev",
  {
    configuration: {
      executeCommandConfiguration: {
        logging: "OVERRIDE",
        logConfiguration: {
          cloudWatchEncryptionEnabled: true,
          cloudWatchLogGroupName: clustereLogGroup.name,
        },
      },
    },
    settings: [
      {
        name: "containerInsights",
        value: "enabled",
      },
    ],
  },
  { protect: true }
);

const launchTemplate = new aws.ec2.LaunchTemplate(
  "launch-template",
  {
    imageId: "",
    instanceType: "",
    vpcSecurityGroupIds: [albSecGroup.id, defaultSecGroup.id],
    iamInstanceProfile: {
      name: "",
    },
    keyName: keyPair.keyName,
    userData: Buffer.from(
      `#!/bin/bash\necho ECS_CLUSTER=${cluster.name} >> /etc/ecs/ecs.config`,
    ).toString("base64"),
  },
  { protect: true }
);

const autoScalingGroup = new aws.autoscaling.Group(
  "scaling-group",
  {
    vpcZoneIdentifiers: vpc.privateSubnetIds,
    desiredCapacity: 1,
    maxSize: 1,
    minSize: 1,
    maxInstanceLifetime: 604800,
    terminationPolicies: ["AllocationStrategy", "OldestInstance"],
    defaultInstanceWarmup: 60,
    defaultCooldown: 120,
    protectFromScaleIn: true,
    launchTemplate: {
      id: launchTemplate.id,
      version: "$Latest",
    },
  },
  { protect: true }
);

const capacityProvider = new aws.ecs.CapacityProvider(
  "cap-provider",
  {
    autoScalingGroupProvider: {
      autoScalingGroupArn: autoScalingGroup.arn,
      managedTerminationProtection: "ENABLED",
      managedScaling: {
        maximumScalingStepSize: 1000,
        minimumScalingStepSize: 1,
        status: "ENABLED",
        targetCapacity: 1,
      },
    },
  },
  { protect: true }
);

// Sometimes needs to be removed (comment out and run pulumi up)
// and recreated to attacted properly to the cluster
const clusterCapacityProviders = new aws.ecs.ClusterCapacityProviders(
  "cluster-capacity-providers",
  {
    clusterName: cluster.name,
    capacityProviders: [capacityProvider.name],
    defaultCapacityProviderStrategies: [
      {
        base: 0,
        weight: 1,
        capacityProvider: capacityProvider.name,
      },
    ],
  },
  { protect: true }
);
