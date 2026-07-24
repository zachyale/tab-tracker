CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `tab_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_account_idx` ON `item` (`account_id`);--> statement-breakpoint
INSERT INTO `item`("id", "account_id", "name", "description", "archived", "position", "created_at") SELECT "id", "account_id", "name", "description", "archived", "position", "created_at" FROM `option`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_option` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`name` text,
	`description` text DEFAULT '' NOT NULL,
	`price_cents` integer,
	`archived` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `tab_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_option`("id", "account_id", "item_id", "name", "description", "price_cents", "archived", "position", "created_at") SELECT "id", "account_id", "id", NULL, '', "price_cents", "archived", 0, "created_at" FROM `option`;--> statement-breakpoint
DROP TABLE `option`;--> statement-breakpoint
ALTER TABLE `__new_option` RENAME TO `option`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `option_account_idx` ON `option` (`account_id`);--> statement-breakpoint
CREATE INDEX `option_item_idx` ON `option` (`item_id`);