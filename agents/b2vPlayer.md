Let simplify our project.

When we run a scenario it should always launch the B2VPlayer app which is going to be a studio for recording and replaing scenarios.

This is a sketch for the player:

+-----------------------------------------------------------------------------------+ 
|[menu]  scenarioname               LIVE/RECORDING                 cachesize [clear|]
+----------+------------------------------+-----------------------------------------+ 
|          |                              |                                         | 
|  step 1  |                              |                                         | 
|          |                              |                                         | 
|  step 2  |                              |                                         | 
|          |                              |              +--------+                 | 
|  step 3  |                              |              |        |                 | 
|          |                              |              |   +    |                 | 
|    +     |                              |              |        |                 | 
|          |                              |              +--------+                 | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              +----+-----+                              | 
|          |       +---------+            |    |     | -+                           | 
|          |       |         |            +----+-----+------------------------------+ 
|          |       |    +    |            |                                         | 
|          |       |         |            |                                         | 
|          |       +---------+            |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
|          |                              |                                         | 
+----------+------------------------------+-----------------------------------------+ 
                                                                                      
                                                                                      
                                                                                      
                                                                                      
                                                                                      
                                                                                      
                                                                                      
menu:                                                                                 
 - new                                                                                
 - open                                                                               
   - recent                                                                           
   - explore                                                                          
 - layout                                                                             
   - split verticaly                                                                  
   - split horizontaly                                                                
   - select preset


   Slides banel should be cloapsible
   Player is controled via nodejs, so nodejs can open new browser windows

   when user creates a new layout use can split it, and add new tabs

Tier 1 - MVP

The goal of this tier is to have a good looking compact player UI whit e2e test that checks:

- when user launches player it started with 1x1 layout with a + button, that allows to select what shoul be in this pane - browser or terminal
- user clicks browser, and see a prompt with url and confirmation button.
- user also see a checkbox "open in dedicated browser window instead iframe (TODO)"
- by default the user opens the github page of this project
- after that user should be able to split the view horizontaly and open a terminal
- user should check that "echo" command is working
- user launched htop command
- user opens anoter terminal tab type "ls"
- user returns to previous terminal tab when back to prev terminal again and ensures text exists
- user close both terminal tabs


   